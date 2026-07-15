/**
 * Live-doc binder (real-time collaboration, phase 2 step 3 — ADR 001 §9).
 *
 * Binds the editor's mutable `pres` object to the shared Y.Doc. The doc is
 * the source of truth while collab live edits are on; `pres` stays the
 * render model. Two directions:
 *
 * - **Local → doc** (`syncLocal`): every editor mutation seam already funnels
 *   through the controller's `markDirty()`; instead of instrumenting each
 *   seam (form onChange closures, inline-edit setByPath, slide-list drag,
 *   AI flows, notes, title, …) the binder diffs `pres` against a shadow
 *   snapshot at that single seam and writes the minimal Y ops: character
 *   patches into Y.Text (common prefix/suffix), splice diffs into item
 *   Y.Arrays, id-matched structural reconcile of the slides Y.Array. All
 *   writes happen in one transaction with the binder's local origin.
 * - **Doc → pres** (observers): remote transactions (and undo/redo, which
 *   apply with the Y.UndoManager as origin) are projected back into `pres`
 *   synchronously, mutating existing slide objects **in place** so that
 *   live form closures keep pointing at the right slide. The
 *   `onRemoteApplied` callback tells the editor glue what to re-render.
 *
 * Because both directions run synchronously, `pres` ≡ active-language
 * projection of the doc ≡ shadow at every quiet moment; a local edit is in
 * the doc before any remote projection can run, so projections never
 * clobber unsynced local work.
 *
 * i18n: the doc stores structure once with per-language texts. `pres` holds
 * the ACTIVE language buffer; the binder writes text changes into
 * `Y.Map<lang, Y.Text>` at the active language and re-projects the other
 * languages' version buffers so "translate from other language" affordances
 * stay fresh. Same-field concurrent typing merges at character level in the
 * doc; while a user is mid-edit in a field the editor overwrites remote
 * characters in that one field on their next keystroke (field-level
 * last-writer-wins — the accepted step-3 fallback; see the reference doc).
 *
 * Undo/redo: Y.UndoManager scoped to the slides array + meta map, tracking
 * only the binder's local origin — undo reverts your own edits, never a
 * collaborator's.
 *
 * The Y namespace and codec are injected (same pattern as the codec itself)
 * so tests can run this against the vendored bundle in Node.
 */

const SERVER_MANAGED_KEYS = new Set([
  'id',
  'created',
  'modified',
  'revision',
  'updatedBy',
  'scope',
]);
const PRES_SPECIAL_KEYS = new Set(['title', 'slides', 'i18n']);
const SLIDE_SPECIAL_KEYS = new Set(['id', 'type', 'content', 'notes']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** JSON-structural equality (undefined-safe). */
function jsonEq(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * @param {Object} opts
 * @param {Object} opts.Y - yjs namespace (must be the same build the doc uses)
 * @param {Object} opts.doc - the provider's Y.Doc
 * @param {Object} opts.codec - createDeckYdocCodec(Y) instance
 * @param {Object} opts.pres - the editor's live presentation object
 * @param {Function} [opts.getActiveLang] - () => active editing language (or null)
 * @param {Function} [opts.onRemoteApplied] - ({changedSlideIds:Set<string>,
 *   structureChanged, titleChanged, metaChanged}) after a doc-driven change
 *   has been projected into `pres`
 * @param {Function} [opts.onUndoStateChanged] - undo/redo stack sizes changed
 * @param {Object} [opts.origin] - transaction origin marker for local writes
 * @returns {Object} binder API
 */
export function createLiveDocBinder({
  Y,
  doc,
  codec,
  pres,
  getActiveLang,
  onRemoteApplied,
  onUndoStateChanged,
  origin = { source: 'deckyard-editor' },
} = {}) {
  if (!Y || !doc || !codec || !pres) {
    throw new Error('createLiveDocBinder: Y, doc, codec and pres are required');
  }

  const yslides = doc.getArray('slides');
  const meta = doc.getMap('meta');

  let destroyed = false;
  let attached = false;
  let undoManager = null;
  let shadowLang = null;
  /** Active-language snapshot of the doc, kept ≡ pres between edits. */
  let shadow = { title: '', slides: [], extra: {}, langs: [], dominant: '', i18nExtra: null };

  const activeLang = () =>
    (typeof getActiveLang === 'function' && getActiveLang()) || codec.getDocDominant(doc);

  function snapshotFromDoc(lang) {
    const ytitle = meta.get('title');
    const yt = ytitle instanceof Y.Map ? ytitle.get(lang) : undefined;
    return {
      title: yt instanceof Y.Text ? yt.toString() : typeof yt === 'string' ? yt : '',
      slides: yslides
        .toArray()
        .map((s) => (s instanceof Y.Map ? codec.projectSlideForLang(s, lang) : deepClone(s))),
      extra: deepClone(meta.get('extra')) || {},
      langs: codec.getDocLangs(doc),
      dominant: codec.getDocDominant(doc),
      i18nExtra: deepClone(meta.get('i18n')) ?? null,
    };
  }

  /** Rebuild the shadow when the editing language switched. */
  function ensureShadowLang() {
    const lang = activeLang();
    if (lang !== shadowLang) {
      shadowLang = lang;
      shadow = snapshotFromDoc(lang);
    }
    return lang;
  }

  // ── local → doc ──────────────────────────────────────────────────────────

  /** Minimal Y.Text patch: keep the common prefix/suffix, replace the middle. */
  function patchYText(ytext, next) {
    const old = ytext.toString();
    if (old === next) return;
    let start = 0;
    const minLen = Math.min(old.length, next.length);
    while (start < minLen && old[start] === next[start]) start += 1;
    let endOld = old.length;
    let endNew = next.length;
    while (endOld > start && endNew > start && old[endOld - 1] === next[endNew - 1]) {
      endOld -= 1;
      endNew -= 1;
    }
    if (endOld > start) ytext.delete(start, endOld - start);
    if (endNew > start) ytext.insert(start, next.slice(start, endNew));
  }

  function writeTextField(container, key, value, lang) {
    const entry = container.get(key);
    if (!(entry instanceof Y.Map)) {
      container.set(key, codec.buildTextFieldForLang(value, lang));
      return;
    }
    const yt = entry.get(lang);
    if (!(yt instanceof Y.Text)) entry.set(lang, new Y.Text(value));
    else patchYText(yt, value);
  }

  /**
   * Diff a content (or item) map. `spec` is the translatable-field spec for
   * this level ({textKeys, items}); `force` skips the equality short-circuit
   * (used after a slide type change, when field classification shifted).
   */
  function diffContentMap(ymap, oldC, newC, spec, lang, { force = false } = {}) {
    const keys = new Set([
      ...Object.keys(isPlainObject(oldC) ? oldC : {}),
      ...Object.keys(isPlainObject(newC) ? newC : {}),
    ]);
    for (const key of keys) {
      const oldV = isPlainObject(oldC) ? oldC[key] : undefined;
      const newV = isPlainObject(newC) ? newC[key] : undefined;
      if (!force && jsonEq(oldV, newV)) continue;
      if (newV === undefined) {
        if (ymap.has(key)) ymap.delete(key);
        continue;
      }
      if (spec.textKeys.has(key) && typeof newV === 'string') {
        writeTextField(ymap, key, newV, lang);
        continue;
      }
      const itemSpec = spec.items.get(key);
      if (itemSpec && Array.isArray(newV)) {
        const yarr = ymap.get(key);
        if (force || !(yarr instanceof Y.Array) || !Array.isArray(oldV)) {
          ymap.set(key, codec.buildItemsForLang(newV, itemSpec, lang));
        } else {
          diffItemsArray(yarr, oldV, newV, itemSpec, lang);
        }
        continue;
      }
      ymap.set(key, deepClone(newV));
    }
  }

  /**
   * Splice diff for an items Y.Array: unchanged prefix/suffix items keep
   * their Y identity (so concurrent edits on other items merge); an
   * equal-length middle diffs item-by-item in place; an unequal middle is
   * replaced wholesale (single-language build — deleted items take their
   * translations with them, which is what deletion means).
   */
  function diffItemsArray(yarr, oldArr, newArr, spec, lang) {
    if (yarr.length !== oldArr.length) {
      // Shadow out of step with the doc (shouldn't happen with synchronous
      // projection, but never corrupt): rebuild the field wholesale.
      yarr.delete(0, yarr.length);
      yarr.insert(0, newArr.map((it) => codec.buildItemForLang(it, spec, lang)));
      return;
    }
    let start = 0;
    const minLen = Math.min(oldArr.length, newArr.length);
    while (start < minLen && jsonEq(oldArr[start], newArr[start])) start += 1;
    let endOld = oldArr.length;
    let endNew = newArr.length;
    while (endOld > start && endNew > start && jsonEq(oldArr[endOld - 1], newArr[endNew - 1])) {
      endOld -= 1;
      endNew -= 1;
    }
    if (endOld - start === endNew - start) {
      for (let i = start; i < endOld; i += 1) {
        const entry = yarr.get(i);
        if (entry instanceof Y.Map && isPlainObject(oldArr[i]) && isPlainObject(newArr[i])) {
          diffContentMap(entry, oldArr[i], newArr[i], spec, lang);
        } else {
          yarr.delete(i, 1);
          yarr.insert(i, [codec.buildItemForLang(newArr[i], spec, lang)]);
        }
      }
      return;
    }
    if (endOld > start) yarr.delete(start, endOld - start);
    if (endNew > start) {
      yarr.insert(
        start,
        newArr.slice(start, endNew).map((it) => codec.buildItemForLang(it, spec, lang))
      );
    }
  }

  const yslideIdAt = (i) => {
    const s = yslides.get(i);
    return s instanceof Y.Map ? s.get('id') : undefined;
  };

  function findYSlideById(id) {
    for (let i = 0; i < yslides.length; i += 1) {
      if (yslideIdAt(i) === id) return yslides.get(i);
    }
    return null;
  }

  /**
   * Make the slides Y.Array match pres' slide id order. Yjs has no move op
   * and forbids re-inserting a removed type, so a move is delete + insert of
   * a deep clone (all languages preserved). All positions are located by id
   * against the live array, never by shadow index.
   */
  function reconcileSlidesToDoc(lang) {
    const target = (pres.slides || []).filter(
      (s) => isPlainObject(s) && typeof s.id === 'string' && s.id
    );
    const targetIds = target.map((s) => s.id);
    const targetIdSet = new Set(targetIds);
    for (let i = yslides.length - 1; i >= 0; i -= 1) {
      if (!targetIdSet.has(yslideIdAt(i))) yslides.delete(i, 1);
    }
    for (let i = 0; i < targetIds.length; i += 1) {
      if (i < yslides.length && yslideIdAt(i) === targetIds[i]) continue;
      let j = -1;
      for (let k = i; k < yslides.length; k += 1) {
        if (yslideIdAt(k) === targetIds[i]) {
          j = k;
          break;
        }
      }
      if (j >= 0) {
        const clone = codec.cloneYValue(yslides.get(j));
        yslides.delete(j, 1);
        yslides.insert(i, [clone]);
      } else {
        yslides.insert(i, [codec.buildSlideForLang(target[i], lang)]);
      }
    }
    while (yslides.length > targetIds.length) yslides.delete(targetIds.length, 1);
  }

  /** Field-level diff of one slide (matched by id) against its shadow. */
  function applySlideToDoc(id, prevSlide, lang) {
    const yslide = findYSlideById(id);
    const next = (pres.slides || []).find((s) => s?.id === id);
    if (!(yslide instanceof Y.Map) || !isPlainObject(next)) return;
    const prev = isPlainObject(prevSlide) ? prevSlide : {};

    const typeChanged = String(next.type || '') !== String(prev.type || '');
    if (typeChanged) yslide.set('type', String(next.type || ''));

    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of keys) {
      if (SLIDE_SPECIAL_KEYS.has(k)) continue;
      if (jsonEq(prev[k], next[k])) continue;
      if (next[k] === undefined) {
        if (yslide.has(k)) yslide.delete(k);
      } else {
        yslide.set(k, deepClone(next[k]));
      }
    }

    const nextNotes = typeof next.notes === 'string' ? next.notes : '';
    const prevNotes = typeof prev.notes === 'string' ? prev.notes : '';
    if (nextNotes !== prevNotes) writeTextField(yslide, 'notes', nextNotes, lang);

    let ycontent = yslide.get('content');
    if (!(ycontent instanceof Y.Map)) {
      ycontent = new Y.Map();
      yslide.set('content', ycontent);
    }
    const spec = codec.textSpecForType(next.type);
    diffContentMap(ycontent, prev.content || {}, next.content || {}, spec, lang, {
      force: typeChanged,
    });
  }

  function applyTitleToDoc(lang) {
    writeTextField(meta, 'title', String(pres.title ?? ''), lang);
  }

  /** Whole-object LWW for top-level extras, preserving server-managed keys. */
  function applyExtraToDoc() {
    const current = isPlainObject(meta.get('extra')) ? meta.get('extra') : {};
    const next = {};
    for (const k of SERVER_MANAGED_KEYS) {
      if (current[k] !== undefined) next[k] = deepClone(current[k]);
    }
    for (const [k, v] of Object.entries(pres)) {
      if (PRES_SPECIAL_KEYS.has(k) || SERVER_MANAGED_KEYS.has(k) || v === undefined) continue;
      next[k] = deepClone(v);
    }
    meta.set('extra', next);
  }

  function presI18nExtra() {
    if (!isPlainObject(pres.i18n)) return null;
    const extra = {};
    for (const [k, v] of Object.entries(pres.i18n)) {
      // `active` is per-client editor state — never shared through the doc
      // (see the codec's bootstrap note; projection emits active = dominant).
      if (k !== 'versions' && k !== 'active') extra[k] = deepClone(v);
    }
    return extra;
  }

  /** Sync langs (additive), dominant and the i18n envelope into meta. */
  function applyI18nToDoc() {
    const versions = isPlainObject(pres.i18n?.versions) ? pres.i18n.versions : null;
    const versionLangs = versions ? Object.keys(versions).filter((l) => isPlainObject(versions[l])) : [];
    // Never invent an i18n block for a single-language deck.
    if (!versionLangs.length && !isPlainObject(meta.get('i18n'))) return;

    const docLangs = codec.getDocLangs(doc);
    const merged = [...docLangs];
    for (const l of versionLangs) {
      if (merged.includes(l)) continue;
      merged.push(l);
      // Seed the new language's title so the created version keeps the
      // title the editor copied over (texts stay empty → '' on projection).
      const seed = typeof versions[l]?.title === 'string' ? versions[l].title : '';
      let ytitle = meta.get('title');
      if (!(ytitle instanceof Y.Map)) {
        meta.set('title', codec.buildTextFieldForLang(seed, l));
      } else if (!(ytitle.get(l) instanceof Y.Text)) {
        ytitle.set(l, new Y.Text(seed));
      }
    }
    if (merged.length !== docLangs.length) meta.set('langs', merged);

    const dom = typeof pres.i18n?.dominant === 'string' ? pres.i18n.dominant : '';
    if (dom && merged.includes(dom) && dom !== codec.getDocDominant(doc)) {
      meta.set('dominant', dom);
    }
    const extra = presI18nExtra();
    if (extra && !jsonEq(extra, meta.get('i18n') ?? null)) meta.set('i18n', extra);
  }

  function detectLocalChanges() {
    const changed = {
      titleChanged: String(pres.title ?? '') !== shadow.title,
      structureChanged: false,
      changedSlideIds: new Set(),
      extraChanged: false,
      i18nChanged: false,
    };

    const presIds = (pres.slides || []).map((s) => (isPlainObject(s) ? s.id : undefined));
    const shadowIds = shadow.slides.map((s) => (isPlainObject(s) ? s.id : undefined));
    changed.structureChanged = presIds.join(' ') !== shadowIds.join(' ');

    const shadowById = new Map(
      shadow.slides.filter((s) => isPlainObject(s) && s.id).map((s) => [s.id, s])
    );
    for (const slide of pres.slides || []) {
      if (!isPlainObject(slide) || !slide.id) continue;
      const prev = shadowById.get(slide.id);
      if (prev && !jsonEq(slide, prev)) changed.changedSlideIds.add(slide.id);
    }

    const filterExtra = (obj) => {
      const out = {};
      for (const [k, v] of Object.entries(isPlainObject(obj) ? obj : {})) {
        if (PRES_SPECIAL_KEYS.has(k) || SERVER_MANAGED_KEYS.has(k) || v === undefined) continue;
        out[k] = v;
      }
      return out;
    };
    changed.extraChanged = !jsonEq(filterExtra(pres), filterExtra(shadow.extra));

    const versionLangs = isPlainObject(pres.i18n?.versions)
      ? Object.keys(pres.i18n.versions).filter((l) => isPlainObject(pres.i18n.versions[l]))
      : [];
    const langsGrew = versionLangs.some((l) => !shadow.langs.includes(l));
    const dominantChanged =
      typeof pres.i18n?.dominant === 'string' &&
      pres.i18n.dominant !== shadow.dominant &&
      (shadow.langs.includes(pres.i18n.dominant) || versionLangs.includes(pres.i18n.dominant));
    const i18nExtraChanged =
      isPlainObject(shadow.i18nExtra) || versionLangs.length
        ? !jsonEq(presI18nExtra(), shadow.i18nExtra)
        : false;
    changed.i18nChanged = langsGrew || dominantChanged || i18nExtraChanged;

    changed.any =
      changed.titleChanged ||
      changed.structureChanged ||
      changed.changedSlideIds.size > 0 ||
      changed.extraChanged ||
      changed.i18nChanged;
    return changed;
  }

  function refreshShadowAfterLocal(changes) {
    if (changes.titleChanged) shadow.title = String(pres.title ?? '');
    if (changes.structureChanged) {
      shadow.slides = (pres.slides || []).map((s) => deepClone(s));
    } else if (changes.changedSlideIds.size) {
      for (const id of changes.changedSlideIds) {
        const idx = shadow.slides.findIndex((s) => s?.id === id);
        const cur = (pres.slides || []).find((s) => s?.id === id);
        if (idx >= 0 && cur) shadow.slides[idx] = deepClone(cur);
      }
    }
    if (changes.extraChanged) shadow.extra = deepClone(meta.get('extra')) || {};
    if (changes.i18nChanged) {
      shadow.langs = codec.getDocLangs(doc);
      shadow.dominant = codec.getDocDominant(doc);
      shadow.i18nExtra = deepClone(meta.get('i18n')) ?? null;
    }
  }

  /**
   * Push local `pres` mutations into the doc. Call after every local edit
   * (the controller's markDirty seam).
   */
  function syncLocal() {
    if (destroyed || !attached) return;
    const lang = ensureShadowLang();
    const changes = detectLocalChanges();
    if (!changes.any) return;
    const shadowById = new Map(
      shadow.slides.filter((s) => isPlainObject(s) && s.id).map((s) => [s.id, s])
    );
    doc.transact(() => {
      if (changes.structureChanged) reconcileSlidesToDoc(lang);
      for (const id of changes.changedSlideIds) {
        applySlideToDoc(id, shadowById.get(id), lang);
      }
      if (changes.titleChanged) applyTitleToDoc(lang);
      if (changes.i18nChanged) applyI18nToDoc();
      if (changes.extraChanged) applyExtraToDoc();
    }, origin);
    refreshShadowAfterLocal(changes);
  }

  // ── doc → pres ───────────────────────────────────────────────────────────

  /** Mutate an existing slide object in place (form closures hold its ref). */
  function mutateSlideInPlace(target, json) {
    for (const k of Object.keys(target)) {
      if (!(k in json)) delete target[k];
    }
    Object.assign(target, json);
  }

  function ensureVersionBuffer(lang) {
    if (!isPlainObject(pres.i18n)) return null;
    if (!isPlainObject(pres.i18n.versions)) pres.i18n.versions = {};
    if (!isPlainObject(pres.i18n.versions[lang])) {
      pres.i18n.versions[lang] = { title: '', slides: [] };
    }
    return pres.i18n.versions[lang];
  }

  /** Re-project the language version buffers from the doc. */
  function refreshVersionBuffers() {
    if (!isPlainObject(pres.i18n) || !isPlainObject(pres.i18n.versions)) return;
    const ytitle = meta.get('title');
    for (const l of codec.getDocLangs(doc)) {
      const buf = ensureVersionBuffer(l);
      if (!buf) return;
      if (l === shadowLang) {
        buf.title = typeof pres.title === 'string' ? pres.title : '';
        buf.slides = pres.slides;
      } else {
        const yt = ytitle instanceof Y.Map ? ytitle.get(l) : undefined;
        buf.title = yt instanceof Y.Text ? yt.toString() : typeof yt === 'string' ? yt : '';
        buf.slides = yslides
          .toArray()
          .map((s) => (s instanceof Y.Map ? codec.projectSlideForLang(s, l) : deepClone(s)));
      }
    }
  }

  function updateVersionBuffersForSlide(yslide, id) {
    if (!isPlainObject(pres.i18n) || !isPlainObject(pres.i18n.versions)) return;
    for (const l of codec.getDocLangs(doc)) {
      if (l === shadowLang) continue;
      const buf = pres.i18n.versions[l];
      if (!isPlainObject(buf) || !Array.isArray(buf.slides)) continue;
      const idx = buf.slides.findIndex((s) => s?.id === id);
      if (idx >= 0) buf.slides[idx] = codec.projectSlideForLang(yslide, l);
    }
  }

  /** Full structural reconcile pres ← doc (order, adds, removals, content). */
  function reconcilePresFromDoc(changedIds) {
    const lang = shadowLang;
    const byId = new Map(
      (pres.slides || []).filter((s) => isPlainObject(s) && s.id).map((s) => [s.id, s])
    );
    const nextSlides = [];
    for (let i = 0; i < yslides.length; i += 1) {
      const ys = yslides.get(i);
      const json =
        ys instanceof Y.Map ? codec.projectSlideForLang(ys, lang) : deepClone(ys);
      const existing = isPlainObject(json) && json.id ? byId.get(json.id) : null;
      if (existing) {
        if (!jsonEq(existing, json)) {
          mutateSlideInPlace(existing, json);
          changedIds.add(json.id);
        }
        nextSlides.push(existing);
      } else {
        nextSlides.push(json);
        if (isPlainObject(json) && json.id) changedIds.add(json.id);
      }
    }
    pres.slides = nextSlides;
    shadow.slides = nextSlides.map((s) => deepClone(s));
    refreshVersionBuffers();
  }

  function projectSlideIntoPres(idx, changedIds) {
    const ys = yslides.get(idx);
    if (!(ys instanceof Y.Map)) return;
    const json = codec.projectSlideForLang(ys, shadowLang);
    if (!json?.id) return;
    const target = (pres.slides || []).find((s) => s?.id === json.id);
    if (!target) {
      // A slide we don't know locally: fall back to the structural path.
      reconcilePresFromDoc(changedIds);
      return;
    }
    if (!jsonEq(target, json)) {
      mutateSlideInPlace(target, json);
      changedIds.add(json.id);
    }
    const sIdx = shadow.slides.findIndex((s) => s?.id === json.id);
    if (sIdx >= 0) shadow.slides[sIdx] = deepClone(json);
    updateVersionBuffersForSlide(ys, json.id);
  }

  function handleRemoteSlides(events) {
    ensureShadowLang();
    let structureChanged = false;
    const changedIndices = new Set();
    for (const ev of events) {
      if (!Array.isArray(ev.path) || ev.path.length === 0) structureChanged = true;
      else if (typeof ev.path[0] === 'number') changedIndices.add(ev.path[0]);
      else structureChanged = true;
    }
    const changedSlideIds = new Set();
    if (structureChanged) {
      reconcilePresFromDoc(changedSlideIds);
    } else {
      for (const idx of changedIndices) projectSlideIntoPres(idx, changedSlideIds);
    }
    if (!structureChanged && changedSlideIds.size === 0) return;
    notifyRemote({ changedSlideIds, structureChanged });
  }

  /**
   * Adopt the doc's meta (title, top-level extras, i18n envelope, langs)
   * into `pres`, comparing against `pres` itself so it also serves as the
   * initial catch-up at attach time. Updates the shadow alongside.
   */
  function applyMetaFromDoc() {
    const lang = ensureShadowLang();
    let titleChanged = false;
    let metaChanged = false;

    const ytitle = meta.get('title');
    const yt = ytitle instanceof Y.Map ? ytitle.get(lang) : undefined;
    const nextTitle = yt instanceof Y.Text ? yt.toString() : typeof yt === 'string' ? yt : '';
    if (nextTitle !== String(pres.title ?? '')) {
      pres.title = nextTitle;
      const buf = isPlainObject(pres.i18n?.versions) ? pres.i18n.versions[lang] : null;
      if (isPlainObject(buf)) buf.title = nextTitle;
      titleChanged = true;
    }
    shadow.title = nextTitle;

    const nextExtra = deepClone(meta.get('extra')) || {};
    for (const k of Object.keys(pres)) {
      if (PRES_SPECIAL_KEYS.has(k) || SERVER_MANAGED_KEYS.has(k)) continue;
      if (!(k in nextExtra)) {
        delete pres[k];
        metaChanged = true;
      }
    }
    for (const [k, v] of Object.entries(nextExtra)) {
      if (PRES_SPECIAL_KEYS.has(k) || SERVER_MANAGED_KEYS.has(k)) continue;
      if (!jsonEq(pres[k], v)) {
        pres[k] = deepClone(v);
        metaChanged = true;
      }
    }
    shadow.extra = nextExtra;

    const nextI18nExtra = deepClone(meta.get('i18n')) ?? null;
    if (isPlainObject(nextI18nExtra) && isPlainObject(pres.i18n)) {
      for (const [k, v] of Object.entries(nextI18nExtra)) {
        // `active` is per-client UI state — never adopt a peer's.
        if (k === 'active' || k === 'versions') continue;
        if (!jsonEq(pres.i18n[k], v)) {
          pres.i18n[k] = deepClone(v);
          metaChanged = true;
        }
      }
    }
    shadow.i18nExtra = nextI18nExtra;

    const nextLangs = codec.getDocLangs(doc);
    if (!jsonEq(nextLangs, shadow.langs)) {
      shadow.langs = nextLangs;
      refreshVersionBuffers();
      metaChanged = true;
    }
    shadow.dominant = codec.getDocDominant(doc);

    return { titleChanged, metaChanged };
  }

  function handleRemoteMeta() {
    const { titleChanged, metaChanged } = applyMetaFromDoc();
    if (titleChanged || metaChanged) {
      notifyRemote({ changedSlideIds: new Set(), structureChanged: false, titleChanged, metaChanged });
    }
  }

  function notifyRemote({
    changedSlideIds = new Set(),
    structureChanged = false,
    titleChanged = false,
    metaChanged = false,
  }) {
    try {
      onRemoteApplied?.({ changedSlideIds, structureChanged, titleChanged, metaChanged });
    } catch {
      // rerender callbacks are best-effort
    }
  }

  const onSlidesEvents = (events, txn) => {
    if (destroyed || txn.origin === origin) return;
    handleRemoteSlides(events);
  };
  const onMetaEvents = (events, txn) => {
    if (destroyed || txn.origin === origin) return;
    handleRemoteMeta(events);
  };

  // ── undo / redo ───────────────────────────────────────────────────────────

  const notifyUndoState = () => {
    try {
      onUndoStateChanged?.({
        undoCount: undoManager?.undoStack?.length || 0,
        redoCount: undoManager?.redoStack?.length || 0,
      });
    } catch {
      // ignore listener errors
    }
  };

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Attach after the provider reports sync. If the user managed to edit
   * before the doc arrived, `flushInitialLocalEdits` pushes those edits into
   * the doc first (diff against the doc snapshot = exactly the local delta);
   * then the doc state is projected out so `pres` catches up with anything
   * newer from other clients.
   */
  function attach({ flushInitialLocalEdits = false } = {}) {
    if (destroyed || attached) return;
    shadowLang = activeLang();
    shadow = snapshotFromDoc(shadowLang);
    attached = true;
    if (flushInitialLocalEdits) syncLocal();

    // Project the full doc into pres (fresh open: no-op diff; catch-up after
    // edits elsewhere: adopts the newer state). The glue re-renders after
    // attach, so no notify here.
    const changedSlideIds = new Set();
    reconcilePresFromDoc(changedSlideIds);
    applyMetaFromDoc();

    yslides.observeDeep(onSlidesEvents);
    meta.observeDeep(onMetaEvents);

    undoManager = new Y.UndoManager([yslides, meta], {
      trackedOrigins: new Set([origin]),
      captureTimeout: 400,
    });
    undoManager.on('stack-item-added', notifyUndoState);
    undoManager.on('stack-item-popped', notifyUndoState);
    undoManager.on('stack-cleared', notifyUndoState);

    return { changedSlideIds };
  }

  function undo() {
    if (!undoManager || !undoManager.undoStack.length) return false;
    return undoManager.undo() != null;
  }

  function redo() {
    if (!undoManager || !undoManager.redoStack.length) return false;
    return undoManager.redo() != null;
  }

  /** Recursively write one language's texts into an existing content map. */
  function adoptContentTexts(ymap, content, spec, lang) {
    if (!isPlainObject(content)) return;
    for (const key of spec.textKeys) {
      const v = content[key];
      if (typeof v !== 'string') continue;
      const entry = ymap.get(key);
      if (entry instanceof Y.Map) {
        const yt = entry.get(lang);
        if (yt instanceof Y.Text) patchYText(yt, v);
        else entry.set(lang, new Y.Text(v));
      } else if (entry === undefined && v) {
        ymap.set(key, codec.buildTextFieldForLang(v, lang));
      }
      // A plain-classified existing entry stays plain (LWW).
    }
    for (const [key, sub] of spec.items) {
      const arr = content[key];
      const yarr = ymap.get(key);
      if (!Array.isArray(arr) || !(yarr instanceof Y.Array)) continue;
      const n = Math.min(arr.length, yarr.length);
      for (let i = 0; i < n; i += 1) {
        const yitem = yarr.get(i);
        if (yitem instanceof Y.Map) adoptContentTexts(yitem, arr[i], sub, lang);
      }
    }
  }

  /**
   * Write a whole language version's texts into the live doc (slides matched
   * by id, items by index; structure untouched). Server-side translate
   * endpoints only update the stored JSON, which the next collab store would
   * overwrite — the editor calls this with the translate response so the
   * translation reaches the doc (the step-4 server-as-collaborator seam will
   * make this unnecessary).
   */
  function adoptLanguageVersion(lang, version) {
    if (destroyed || !attached || !lang || !isPlainObject(version)) return;
    const slidesIn = Array.isArray(version.slides) ? version.slides : [];
    doc.transact(() => {
      const docLangs = codec.getDocLangs(doc);
      if (!docLangs.includes(lang)) meta.set('langs', [...docLangs, lang]);
      if (typeof version.title === 'string') {
        writeTextField(meta, 'title', version.title, lang);
      }
      for (const slide of slidesIn) {
        if (!isPlainObject(slide) || typeof slide.id !== 'string') continue;
        const yslide = findYSlideById(slide.id);
        if (!(yslide instanceof Y.Map)) continue;
        if (typeof slide.notes === 'string' && slide.notes) {
          writeTextField(yslide, 'notes', slide.notes, lang);
        }
        const ycontent = yslide.get('content');
        if (!(ycontent instanceof Y.Map)) continue;
        adoptContentTexts(
          ycontent,
          slide.content,
          codec.textSpecForType(yslide.get('type')),
          lang
        );
      }
    }, origin);
    shadow.langs = codec.getDocLangs(doc);
    refreshVersionBuffers();
    if (lang === shadowLang) {
      // Adopted texts for the language being edited: re-project them out.
      const changedSlideIds = new Set();
      reconcilePresFromDoc(changedSlideIds);
      applyMetaFromDoc();
      notifyRemote({ changedSlideIds, structureChanged: false, titleChanged: true, metaChanged: true });
    }
  }

  /**
   * Project the full deck for a language switch: the legacy-format
   * presentation with top-level title/slides set to the requested language
   * (the same shape `GET /api/presentations/:id?lang=` returns), fresh from
   * the live doc instead of the (up to one debounce window stale) JSON.
   */
  function projectLanguage(lang) {
    const projected = codec.projectDocToPresentation(doc);
    const version = projected?.i18n?.versions?.[lang];
    if (version) {
      projected.title = version.title;
      projected.slides = version.slides;
    }
    for (const k of SERVER_MANAGED_KEYS) delete projected[k];
    return projected;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (attached) {
      try {
        yslides.unobserveDeep(onSlidesEvents);
        meta.unobserveDeep(onMetaEvents);
      } catch {
        // ignore
      }
    }
    try {
      undoManager?.destroy();
    } catch {
      // ignore
    }
    undoManager = null;
  }

  return {
    attach,
    syncLocal,
    undo,
    redo,
    canUndo: () => !!undoManager && undoManager.undoStack.length > 0,
    canRedo: () => !!undoManager && undoManager.redoStack.length > 0,
    projectLanguage,
    adoptLanguageVersion,
    destroy,
    /** Exposed for tests. */
    _origin: origin,
  };
}
