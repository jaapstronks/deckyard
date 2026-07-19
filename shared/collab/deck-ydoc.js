/**
 * Deck ⇄ Y.Doc codec (real-time collaboration, phase 2 — ADR 001 §4).
 *
 * Maps the legacy presentation JSON onto a CRDT document that stores the
 * deck structure ONCE and per-language values inside each translatable
 * field, instead of today's full slides-array copy per language:
 *
 *   ydoc
 *   ├── meta: Y.Map
 *   │     title: Y.Map<lang, Y.Text>
 *   │     dominant: string            // e.g. 'nl'
 *   │     langs: string[]             // language versions present
 *   │     extra: JSON                 // top-level keys except slides/title/i18n
 *   │     i18n: JSON|null             // i18n minus versions (null = no i18n block)
 *   └── slides: Y.Array<Y.Map>
 *         id, type, <other slide keys>: plain LWW values
 *         notes: Y.Map<lang, Y.Text>
 *         content: Y.Map
 *           <plain field>: LWW value           // enums, numbers, images, …
 *           <text field>:  Y.Map<lang, Y.Text> // string + markdown fields
 *           <items field>: Y.Array<Y.Map>      // recursive, same rules
 *
 * The content encoding is self-describing: on a content (or item) map, a
 * nested Y.Map is always a lang→Y.Text map, a nested Y.Array is always an
 * items list, anything else is a plain value. Projection back to JSON
 * therefore needs no schema; only the JSON→doc bootstrap consults
 * SLIDE_TYPES to classify fields (string/markdown = per-language text,
 * mirroring the i18n translate pipeline; `hidden` fields stay plain).
 *
 * The legacy JSON format is preserved at this boundary: the projection
 * rebuilds `i18n.versions[lang].slides` arrays (and top-level title/slides
 * from the dominant language), so storage, exports and the public API keep
 * seeing the exact format they see today.
 *
 * Bootstrap normalization policy (matches the editor's
 * syncOtherLanguageStructureForSave): the dominant language version owns
 * the structure — slide order, slide set, item counts and every
 * non-translatable value. Slides that only exist in another language
 * version are dropped (reported in `warnings`), diverging types follow the
 * dominant version, and per-language item texts are matched by index.
 *
 * This module is shared between server (yjs from npm) and client (vendored
 * bundle), so the Y namespace is injected instead of imported.
 */

import { SLIDE_TYPES } from '../slide-types.js';

/** Slide-level keys with dedicated handling (everything else is plain LWW). */
const SLIDE_SPECIAL_KEYS = new Set(['id', 'type', 'content', 'notes']);

/** Top-level presentation keys owned by the doc rather than `meta.extra`. */
const PRES_SPECIAL_KEYS = new Set(['title', 'slides', 'i18n']);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/**
 * Build the translatable-text spec for a list of schema fields, recursively:
 * `{ textKeys: Set<string>, items: Map<fieldKey, spec> }`.
 * string/markdown fields are per-language text (same classification as the
 * i18n translate pipeline); `hidden` fields (machine ids etc.) stay plain.
 */
function specForFields(fields) {
  const spec = { textKeys: new Set(), items: new Map() };
  for (const f of Array.isArray(fields) ? fields : []) {
    const key = typeof f?.key === 'string' ? f.key.trim() : '';
    if (!key || f.hidden === true) continue;
    if (f.type === 'string' || f.type === 'markdown' || f.type === 'csv')
      spec.textKeys.add(key);
    else if (f.type === 'items' && Array.isArray(f.itemFields)) {
      spec.items.set(key, specForFields(f.itemFields));
    }
  }
  return spec;
}

const EMPTY_SPEC = { textKeys: new Set(), items: new Map() };

/**
 * Minimal Y.Text patch: keep the common prefix/suffix, replace the middle.
 * No-op when the text already matches. Shared by the client binder and the
 * server-side apply differ so both produce the same mergeable ops.
 * @param {Object} ytext - Y.Text instance
 * @param {string} next - Target string value
 */
export function patchYText(ytext, next) {
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

/**
 * Resolve a legacy presentation's language versions: which languages exist,
 * which one is dominant, and a normalized `{title, slides}` per language.
 * Decks without an i18n block become a single-language world keyed by
 * `pres.lang`. Shared by bootstrap and the server-side apply differ.
 * @param {Object} pres - Presentation in the legacy JSON format
 * @returns {{versions: Object, langs: string[], dominant: string, hasI18n: boolean}}
 */
function resolveVersions(pres) {
  const hasI18n = isPlainObject(pres?.i18n);
  const rawVersions = hasI18n && isPlainObject(pres.i18n.versions) ? pres.i18n.versions : {};
  const versionLangs = Object.keys(rawVersions).filter((l) => isPlainObject(rawVersions[l]));
  const fallbackLang =
    (typeof pres?.lang === 'string' && pres.lang) ||
    (hasI18n && typeof pres.i18n.dominant === 'string' && pres.i18n.dominant) ||
    'nl';
  const dominant =
    (hasI18n && typeof pres.i18n.dominant === 'string' && rawVersions[pres.i18n.dominant]
      ? pres.i18n.dominant
      : versionLangs[0]) || fallbackLang;

  const versions = {};
  if (versionLangs.length) {
    for (const l of versionLangs) {
      versions[l] = {
        title: typeof rawVersions[l].title === 'string' ? rawVersions[l].title : '',
        slides: Array.isArray(rawVersions[l].slides) ? rawVersions[l].slides : [],
      };
    }
  } else {
    versions[dominant] = {
      title: typeof pres?.title === 'string' ? pres.title : '',
      slides: Array.isArray(pres?.slides) ? pres.slides : [],
    };
  }
  return { versions, langs: Object.keys(versions), dominant, hasI18n };
}

/** JSON-structural equality (undefined-safe). */
function jsonEq(a, b) {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Translatable-text spec for a slide type (recursive over items fields).
 * Unknown types get an empty spec: every field is treated as plain LWW.
 * @param {string} type - Slide type name
 * @param {Object} [slideTypes] - Slide-type registry (defaults to SLIDE_TYPES)
 * @returns {{textKeys: Set<string>, items: Map<string, Object>}}
 */
export function textFieldSpecForType(type, slideTypes = SLIDE_TYPES) {
  const def = slideTypes?.[type];
  if (!def || !Array.isArray(def.fields)) return EMPTY_SPEC;
  return specForFields(def.fields);
}

/**
 * Create a codec bound to a Y namespace (server: `import * as Y from 'yjs'`;
 * client: `import { Y } from '../vendor/collab.js'`).
 *
 * @param {Object} Y - The yjs namespace (Doc, Map, Array, Text)
 * @param {Object} [options]
 * @param {Object} [options.slideTypes] - Slide-type registry override (forks/tests)
 * @returns {{
 *   bootstrapPresentationToDoc: (pres: Object, doc: Object) => {warnings: string[]},
 *   applyPresentationToDoc: (pres: Object, doc: Object) => {warnings: string[]},
 *   projectDocToPresentation: (doc: Object) => Object,
 *   getDocLangs: (doc: Object) => string[],
 *   getDocDominant: (doc: Object) => string,
 *   buildSlideForLang: (slide: Object, lang: string) => Object,
 *   buildItemsForLang: (arr: Array, spec: Object, lang: string) => Object,
 *   buildItemForLang: (item: *, spec: Object, lang: string) => *,
 *   buildTextFieldForLang: (value: string, lang: string) => Object,
 *   projectSlideForLang: (yslide: Object, lang: string) => Object,
 *   projectValueForLang: (value: *, lang: string) => *,
 *   cloneYValue: (value: *) => *,
 * }}
 */
export function createDeckYdocCodec(Y, { slideTypes = SLIDE_TYPES } = {}) {
  // ── shared helpers ──────────────────────────────────────────────────────

  /** lang→Y.Text map from a lang→string record (missing langs stay absent). */
  function langTextMap(values) {
    const m = new Y.Map();
    for (const [lang, v] of Object.entries(values)) {
      if (typeof v === 'string') m.set(lang, new Y.Text(v));
    }
    return m;
  }

  /** Read `content?.[key]` when it's a string, else undefined. */
  function textAt(slide, key) {
    const v = slide?.content?.[key];
    return typeof v === 'string' ? v : undefined;
  }

  // ── JSON → Y.Doc ────────────────────────────────────────────────────────

  /**
   * Build one item (array entry) as a Y.Map (or plain value passthrough).
   * @param {*} item - The dominant-language item
   * @param {Object[]} peers - `{lang, item}` matching items in other versions
   * @param {Object} spec - Text spec for this items level
   */
  function buildItem(item, peers, spec) {
    if (!isPlainObject(item)) return deepClone(item);
    const m = new Y.Map();
    const keys = new Set(Object.keys(item));
    for (const k of spec.textKeys) keys.add(k); // union: peer-only texts survive
    for (const key of keys) {
      if (spec.textKeys.has(key)) {
        const values = {};
        if (typeof item[key] === 'string') values[peers.dominantLang] = item[key];
        for (const { lang, item: peer } of peers.list) {
          const v = peer?.[key];
          if (typeof v === 'string') values[lang] = v;
        }
        if (Object.keys(values).length) m.set(key, langTextMap(values));
        else if (item[key] !== undefined) m.set(key, deepClone(item[key]));
        continue;
      }
      const itemSpec = spec.items.get(key);
      if (itemSpec && Array.isArray(item[key])) {
        m.set(key, buildItemsArray(item[key], key, peers, itemSpec));
        continue;
      }
      if (item[key] !== undefined) m.set(key, deepClone(item[key]));
    }
    return m;
  }

  /**
   * Build an items field as Y.Array. Per-language item texts are matched by
   * index (same policy as the editor's language sync).
   */
  function buildItemsArray(arr, fieldKey, peers, spec) {
    const yarr = new Y.Array();
    const built = arr.map((item, i) => {
      const itemPeers = {
        dominantLang: peers.dominantLang,
        list: peers.list.map(({ lang, item: peerParent }) => ({
          lang,
          item: Array.isArray(peerParent?.[fieldKey]) ? peerParent[fieldKey][i] : undefined,
        })),
      };
      return buildItem(item, itemPeers, spec);
    });
    yarr.push(built);
    return yarr;
  }

  /**
   * Build one slide as a Y.Map. `matches` carries the other language
   * versions' slides (`{lang, slide}`), empty for a single-language build.
   * Plain-field divergence across versions is reported into `warnings`.
   */
  function buildSlideYMap(slide, { lang, matches = [], warnings = [] } = {}) {
    const ymap = new Y.Map();
    if (!isPlainObject(slide)) return ymap;
    const sid = typeof slide.id === 'string' ? slide.id : '';
    ymap.set('id', sid);
    ymap.set('type', typeof slide.type === 'string' ? slide.type : '');

    // Notes are per-language.
    const notesValues = {};
    if (typeof slide.notes === 'string') notesValues[lang] = slide.notes;
    for (const { lang: peerLang, slide: peer } of matches) {
      if (typeof peer.notes === 'string') notesValues[peerLang] = peer.notes;
    }
    ymap.set('notes', langTextMap(notesValues));

    // Content: classify per schema; unknown keys stay plain.
    const spec = textFieldSpecForType(slide.type, slideTypes);
    const content = isPlainObject(slide.content) ? slide.content : {};
    const ycontent = new Y.Map();
    const keys = new Set(Object.keys(content));
    for (const k of spec.textKeys) {
      // Union with schema text keys so a translation that only exists in
      // a non-dominant version isn't dropped.
      if (matches.some(({ slide: peer }) => typeof textAt(peer, k) === 'string')) keys.add(k);
    }
    for (const key of keys) {
      if (spec.textKeys.has(key)) {
        const values = {};
        if (typeof content[key] === 'string') values[lang] = content[key];
        for (const { lang: peerLang, slide: peer } of matches) {
          const v = textAt(peer, key);
          if (typeof v === 'string') values[peerLang] = v;
        }
        if (Object.keys(values).length) ycontent.set(key, langTextMap(values));
        // Schema says text but the value isn't a string: keep as plain.
        else if (content[key] !== undefined) ycontent.set(key, deepClone(content[key]));
        continue;
      }
      const itemSpec = spec.items.get(key);
      if (itemSpec && Array.isArray(content[key])) {
        const peers = {
          dominantLang: lang,
          list: matches.map(({ lang: peerLang, slide: peer }) => ({
            lang: peerLang,
            item: isPlainObject(peer.content) ? peer.content : {},
          })),
        };
        ycontent.set(key, buildItemsArray(content[key], key, peers, itemSpec));
        continue;
      }
      if (content[key] !== undefined) {
        ycontent.set(key, deepClone(content[key]));
        // Plain values normalize to the dominant version. Legacy decks
        // can diverge here (e.g. deprecated `hidden` fields, which the
        // translate pipeline does copy per language but this codec
        // deliberately keeps plain) — surface it instead of silently
        // dropping the other version's value.
        const dominantJson = JSON.stringify(content[key]);
        for (const { lang: peerLang, slide: peer } of matches) {
          const pv = peer?.content?.[key];
          if (pv !== undefined && JSON.stringify(pv) !== dominantJson) {
            warnings.push(`slide ${sid}: plain field '${key}' differs in version '${peerLang}' — dominant wins`);
          }
        }
      }
    }
    ymap.set('content', ycontent);

    // Any other slide-level keys ride along as plain LWW values.
    for (const [k, v] of Object.entries(slide)) {
      if (!SLIDE_SPECIAL_KEYS.has(k) && v !== undefined) ymap.set(k, deepClone(v));
    }
    return ymap;
  }

  /**
   * Bootstrap an (empty) Y.Doc from a legacy presentation JSON.
   * @param {Object} pres - Presentation in the legacy JSON format
   * @param {Object} doc - A fresh Y.Doc to populate
   * @returns {{warnings: string[]}} Lossy-normalization notes (dropped
   *   slides, type mismatches); empty when the versions were in sync.
   */
  function bootstrapPresentationToDoc(pres, doc) {
    const warnings = [];
    const { versions, langs, dominant, hasI18n } = resolveVersions(pres);
    const otherLangs = langs.filter((l) => l !== dominant);

    doc.transact(() => {
      const meta = doc.getMap('meta');

      const titleValues = {};
      for (const l of langs) titleValues[l] = versions[l].title;
      meta.set('title', langTextMap(titleValues));
      meta.set('dominant', dominant);
      meta.set('langs', langs);

      const extra = {};
      for (const [k, v] of Object.entries(isPlainObject(pres) ? pres : {})) {
        if (!PRES_SPECIAL_KEYS.has(k)) extra[k] = deepClone(v);
      }
      meta.set('extra', extra);

      if (hasI18n) {
        const i18nExtra = {};
        for (const [k, v] of Object.entries(pres.i18n)) {
          // `active` is per-client editor state; freezing one client's value
          // into the shared doc corrupts other versions on serialize (the
          // storage facade's normalizeI18n overwrites versions[active] with
          // the top-level = dominant buffers). Projection re-emits
          // active = dominant instead.
          if (k !== 'versions' && k !== 'active') i18nExtra[k] = deepClone(v);
        }
        meta.set('i18n', i18nExtra);
      } else {
        meta.set('i18n', null);
      }

      // Per-language slide lookup by id (structure follows the dominant version).
      const peersById = otherLangs.map((lang) => ({
        lang,
        byId: new Map(
          versions[lang].slides
            .filter((s) => isPlainObject(s) && typeof s.id === 'string' && s.id)
            .map((s) => [s.id, s])
        ),
      }));

      const dominantIds = new Set(
        versions[dominant].slides.map((s) => (isPlainObject(s) ? s.id : undefined)).filter(Boolean)
      );
      for (const { lang, byId } of peersById) {
        for (const id of byId.keys()) {
          if (!dominantIds.has(id)) {
            warnings.push(`slide ${id} only exists in version '${lang}' — dropped (structure follows '${dominant}')`);
          }
        }
      }

      const yslides = doc.getArray('slides');
      const built = versions[dominant].slides.map((slide) => {
        if (!isPlainObject(slide)) return new Y.Map();
        const sid = typeof slide.id === 'string' ? slide.id : '';
        const matches = peersById
          .map(({ lang, byId }) => ({ lang, slide: sid ? byId.get(sid) : undefined }))
          .filter((p) => isPlainObject(p.slide));

        for (const { lang, slide: peer } of matches) {
          if (peer.type !== slide.type) {
            warnings.push(`slide ${sid}: type '${peer.type}' in version '${lang}' differs from dominant '${slide.type}' — dominant wins`);
          }
        }

        return buildSlideYMap(slide, { lang: dominant, matches, warnings });
      });
      yslides.push(built);
    });

    return { warnings };
  }

  // ── Y.Doc → JSON ────────────────────────────────────────────────────────

  /** Project one content/item value for a language (self-describing walk). */
  function projectValue(value, lang) {
    if (value instanceof Y.Map) {
      // lang → Y.Text map
      const t = value.get(lang);
      return t instanceof Y.Text ? t.toString() : typeof t === 'string' ? t : '';
    }
    if (value instanceof Y.Array) {
      return value.toArray().map((entry) => {
        if (entry instanceof Y.Map) {
          const item = {};
          for (const [k, v] of entry.entries()) item[k] = projectValue(v, lang);
          return item;
        }
        return deepClone(entry);
      });
    }
    return deepClone(value);
  }

  /** Project one slide Y.Map to a legacy slide object for a language. */
  function projectSlide(yslide, lang) {
    const slide = {};
    for (const [k, v] of yslide.entries()) {
      if (k === 'content' || k === 'notes') continue;
      slide[k] = deepClone(v);
    }
    const ynotes = yslide.get('notes');
    const noteText = ynotes instanceof Y.Map ? ynotes.get(lang) : undefined;
    slide.notes = noteText instanceof Y.Text ? noteText.toString() : '';

    const content = {};
    const ycontent = yslide.get('content');
    if (ycontent instanceof Y.Map) {
      for (const [k, v] of ycontent.entries()) content[k] = projectValue(v, lang);
    }
    slide.content = content;
    return slide;
  }

  /** @param {Object} doc @returns {string[]} Language versions in the doc. */
  function getDocLangs(doc) {
    const langs = doc.getMap('meta').get('langs');
    return Array.isArray(langs) ? [...langs] : [];
  }

  /** @param {Object} doc @returns {string} The dominant language. */
  function getDocDominant(doc) {
    const d = doc.getMap('meta').get('dominant');
    return typeof d === 'string' && d ? d : 'nl';
  }

  /**
   * Project a Y.Doc back to the legacy presentation JSON, rebuilding
   * `i18n.versions[lang]` arrays and the top-level title/slides from the
   * dominant language.
   * @param {Object} doc - A populated Y.Doc
   * @returns {Object} Presentation in the legacy JSON format
   */
  function projectDocToPresentation(doc) {
    const meta = doc.getMap('meta');
    const dominant = getDocDominant(doc);
    const langs = getDocLangs(doc);
    const effectiveLangs = langs.length ? langs : [dominant];

    const pres = deepClone(meta.get('extra')) || {};

    const ytitle = meta.get('title');
    const yslides = doc.getArray('slides');
    const versions = {};
    for (const lang of effectiveLangs) {
      const t = ytitle instanceof Y.Map ? ytitle.get(lang) : undefined;
      versions[lang] = {
        title: t instanceof Y.Text ? t.toString() : '',
        slides: yslides.toArray().map((s) => (s instanceof Y.Map ? projectSlide(s, lang) : deepClone(s))),
      };
    }

    const dv = versions[dominant] || versions[effectiveLangs[0]];
    pres.title = dv.title;
    pres.slides = dv.slides;

    const i18nExtra = meta.get('i18n');
    if (isPlainObject(i18nExtra)) {
      // active = dominant keeps the pair consistent: normalizeI18n syncs
      // versions[active] from the top-level buffers, which hold the dominant
      // language here. (Docs bootstrapped before this rule may still carry a
      // stored `active`; the dominant wins over it.)
      pres.i18n = { ...deepClone(i18nExtra), active: dominant, versions };
    }
    return pres;
  }

  // ── binder helpers (phase 2, step 3) ────────────────────────────────────

  /**
   * Deep-clone a Y value (or plain value). Yjs types cannot be re-inserted
   * after removal, so a "move" in a Y.Array is delete + insert of a clone;
   * cloning preserves every language's texts, unlike rebuilding from a
   * single-language JSON projection.
   */
  function cloneYValue(value) {
    if (value instanceof Y.Map) {
      const m = new Y.Map();
      for (const [k, v] of value.entries()) m.set(k, cloneYValue(v));
      return m;
    }
    if (value instanceof Y.Array) {
      const a = new Y.Array();
      a.push(value.toArray().map((v) => cloneYValue(v)));
      return a;
    }
    if (value instanceof Y.Text) return new Y.Text(value.toString());
    return deepClone(value);
  }

  // ── server-side apply (phase 2, step 4) ─────────────────────────────────

  /** {[lang]: value} view of one key across per-language variants. */
  function keyViewByLang(byLang, key) {
    const view = {};
    for (const [lang, obj] of Object.entries(byLang)) {
      const v = isPlainObject(obj) ? obj[key] : undefined;
      if (v !== undefined) view[lang] = v;
    }
    return view;
  }

  /** {[lang]: string} — only the string values (Y.Text patch targets). */
  function textValuesByLang(byLang, key) {
    const values = {};
    for (const [lang, obj] of Object.entries(byLang)) {
      const v = isPlainObject(obj) ? obj[key] : undefined;
      if (typeof v === 'string') values[lang] = v;
    }
    return values;
  }

  /** Per-language view of the item at `[key][i]` under each variant. */
  function itemViewByLangAt(byLang, key, i) {
    const view = {};
    for (const [lang, obj] of Object.entries(byLang)) {
      const arr = isPlainObject(obj) ? obj[key] : undefined;
      const item = Array.isArray(arr) ? arr[i] : undefined;
      if (item !== undefined) view[lang] = item;
    }
    return view;
  }

  /** Builder-shaped peers ({dominantLang, list}) from a by-lang view. */
  function peersFromByLang(byLang, dominantLang) {
    const list = [];
    for (const [lang, item] of Object.entries(byLang)) {
      if (lang !== dominantLang) list.push({ lang, item });
    }
    return { dominantLang, list };
  }

  /**
   * Patch a lang→Y.Text entry at `ymap[key]` towards `values`
   * ({lang: string}). With `baseValues` (three-way mode) only languages
   * whose value actually changed vs the base are written — concurrent
   * client typing in other languages survives. Languages the incoming deck
   * has no string for are left untouched (a missing translation projects
   * as '' anyway).
   */
  function applyTextField(ymap, key, values, baseValues) {
    const entry = ymap.get(key);
    if (!(entry instanceof Y.Map)) {
      if (baseValues && jsonEq(values, baseValues)) return;
      ymap.set(key, langTextMap(values));
      return;
    }
    for (const [lang, v] of Object.entries(values)) {
      if (baseValues && baseValues[lang] === v) continue;
      const yt = entry.get(lang);
      if (yt instanceof Y.Text) patchYText(yt, v);
      else entry.set(lang, new Y.Text(v));
    }
  }

  /**
   * Index-matched diff of an items Y.Array (the step-4 policy: items have
   * no ids, so position is identity). Items whose per-language values equal
   * the caller's base are skipped entirely; changed items diff in place so
   * concurrent edits on untouched fields merge. The array length only
   * changes when the caller changed it vs the base (an item a client added
   * concurrently survives a text-only server edit). A mid-list insert
   * rewrites the shifted items — accepted for server writes.
   */
  function applyItemsArray(yarr, arr, key, spec, ctx) {
    const { incByLang, baseByLang, dominant } = ctx;
    const incAt = (i) => itemViewByLangAt(incByLang, key, i);
    const baseAt = baseByLang ? (i) => itemViewByLangAt(baseByLang, key, i) : null;
    const buildAt = (i) => buildItem(arr[i], peersFromByLang(incAt(i), dominant), spec);

    const n = arr.length;
    const common = Math.min(yarr.length, n);
    for (let i = 0; i < common; i += 1) {
      const itemView = incAt(i);
      if (baseAt && jsonEq(itemView, baseAt(i))) continue;
      const yitem = yarr.get(i);
      const item = arr[i];
      if (yitem instanceof Y.Map && isPlainObject(item)) {
        applyContentMap(yitem, spec, {
          ...ctx,
          incByLang: itemView,
          baseByLang: baseAt ? baseAt(i) : null,
          warnLabel: null,
        });
      } else if (!(yitem instanceof Y.Map) && !isPlainObject(item) && jsonEq(yitem, item)) {
        // Equal plain passthrough values — leave as-is.
      } else {
        yarr.delete(i, 1);
        yarr.insert(i, [buildAt(i)]);
      }
    }

    const baseRef = baseByLang ? baseByLang[dominant] : undefined;
    const baseArr = isPlainObject(baseRef) ? baseRef[key] : undefined;
    const lengthTouched = !baseAt || !Array.isArray(baseArr) || baseArr.length !== n;
    if (!lengthTouched) return;
    if (yarr.length > n) yarr.delete(n, yarr.length - n);
    else if (yarr.length < n) {
      const from = yarr.length;
      yarr.insert(
        from,
        arr.slice(from).map((_, off) => buildAt(from + off))
      );
    }
  }

  /**
   * Diff a content (or item) map against incoming per-language values
   * (`ctx.incByLang` = {lang: contentObject}). In three-way mode
   * (`ctx.baseByLang` set) keys whose per-language values equal the base
   * are skipped, and keys are only deleted when the base knew them — so
   * concurrent client edits on fields the caller didn't touch survive.
   * `force` skips in-place patching after a slide type change (field
   * classification shifted). `warnLabel` enables the plain-field divergence
   * warning at slide content level (parity with bootstrap).
   */
  function applyContentMap(ymap, spec, ctx) {
    const { incByLang, baseByLang, dominant, warnings, force = false, warnLabel = null } = ctx;
    const domObj = isPlainObject(incByLang[dominant]) ? incByLang[dominant] : {};
    const keys = new Set(Object.keys(domObj));
    for (const k of spec.textKeys) {
      if (Object.keys(textValuesByLang(incByLang, k)).length) keys.add(k);
    }
    for (const k of ymap.keys()) keys.add(k);

    for (const key of keys) {
      const incoming = domObj[key];
      const baseView = baseByLang ? keyViewByLang(baseByLang, key) : null;
      if (baseView && !force && jsonEq(keyViewByLang(incByLang, key), baseView)) continue;

      const textValues = spec.textKeys.has(key) ? textValuesByLang(incByLang, key) : null;
      if (incoming === undefined && !(textValues && Object.keys(textValues).length)) {
        // Key absent from the incoming deck: delete it — in three-way mode
        // only when the caller's base knew it (else it's a concurrent
        // client addition).
        const baseKnew = baseView ? Object.keys(baseView).length > 0 : true;
        if (baseKnew && ymap.has(key)) ymap.delete(key);
        continue;
      }
      if (textValues && Object.keys(textValues).length) {
        if (force) ymap.set(key, langTextMap(textValues));
        else {
          applyTextField(
            ymap,
            key,
            textValues,
            baseByLang ? textValuesByLang(baseByLang, key) : null
          );
        }
        continue;
      }
      const itemSpec = spec.items.get(key);
      if (itemSpec && Array.isArray(incoming)) {
        const yarr = ymap.get(key);
        if (force || !(yarr instanceof Y.Array)) {
          ymap.set(key, buildItemsArray(incoming, key, peersFromByLang(incByLang, dominant), itemSpec));
        } else {
          applyItemsArray(yarr, incoming, key, itemSpec, ctx);
        }
        continue;
      }
      // Plain LWW value (normalizes to the dominant version, with a warning
      // when other versions diverge — same policy as bootstrap).
      const cur = ymap.get(key);
      const isYType = cur instanceof Y.Map || cur instanceof Y.Array || cur instanceof Y.Text;
      if (isYType || !jsonEq(cur, incoming)) ymap.set(key, deepClone(incoming));
      if (warnLabel) {
        const dominantJson = JSON.stringify(incoming);
        for (const [lang, obj] of Object.entries(incByLang)) {
          if (lang === dominant) continue;
          const pv = isPlainObject(obj) ? obj[key] : undefined;
          if (pv !== undefined && JSON.stringify(pv) !== dominantJson) {
            warnings.push(
              `${warnLabel}: plain field '${key}' differs in version '${lang}' — dominant wins`
            );
          }
        }
      }
    }
  }

  /** Warn when other language versions disagree on a slide's type. */
  function warnTypeDivergence(sid, slide, matches, warnings) {
    for (const { lang, slide: peer } of matches) {
      if (peer.type !== slide.type) {
        warnings.push(
          `slide ${sid}: type '${peer.type}' in version '${lang}' differs from dominant '${slide.type}' — dominant wins`
        );
      }
    }
  }

  /**
   * Field-level diff of one existing slide Y.Map across all languages.
   * `slideByLang` = {lang: slideObject}; `baseSlideByLang` (three-way mode)
   * gates every write on whether the caller actually changed the value vs
   * the deck state their write was based on.
   */
  function applySlideYMap(yslide, { dominant, slideByLang, baseSlideByLang, warnings }) {
    const slide = slideByLang[dominant];
    const baseSlide = baseSlideByLang ? baseSlideByLang[dominant] : undefined;
    const sid = typeof slide.id === 'string' ? slide.id : '';
    const nextType = typeof slide.type === 'string' ? slide.type : '';
    const matches = [];
    for (const [lang, s] of Object.entries(slideByLang)) {
      if (lang !== dominant && isPlainObject(s)) matches.push({ lang, slide: s });
    }
    warnTypeDivergence(sid, slide, matches, warnings);

    const typeTouched =
      !baseSlideByLang ||
      String(isPlainObject(baseSlide) ? baseSlide.type || '' : '') !== nextType;
    let typeChanged = false;
    if (typeTouched && String(yslide.get('type') || '') !== nextType) {
      yslide.set('type', nextType);
      typeChanged = true;
    }

    // Slide-level plain keys (everything except id/type/content/notes).
    const slideKeys = new Set(Object.keys(slide));
    for (const k of yslide.keys()) slideKeys.add(k);
    for (const key of slideKeys) {
      if (SLIDE_SPECIAL_KEYS.has(key)) continue;
      const v = slide[key];
      if (baseSlideByLang && jsonEq(v, isPlainObject(baseSlide) ? baseSlide[key] : undefined)) {
        continue; // untouched by the caller
      }
      if (v === undefined) {
        if (yslide.has(key)) yslide.delete(key);
      } else if (!jsonEq(yslide.get(key), v)) {
        yslide.set(key, deepClone(v));
      }
    }

    // Notes per language.
    const notesValues = {};
    for (const [lang, s] of Object.entries(slideByLang)) {
      if (typeof s?.notes === 'string') notesValues[lang] = s.notes;
    }
    let baseNotes = null;
    if (baseSlideByLang) {
      baseNotes = {};
      for (const [lang, s] of Object.entries(baseSlideByLang)) {
        if (typeof s?.notes === 'string') baseNotes[lang] = s.notes;
      }
    }
    applyTextField(yslide, 'notes', notesValues, baseNotes);

    // Content, classified by the (possibly new) type's schema.
    let ycontent = yslide.get('content');
    if (!(ycontent instanceof Y.Map)) {
      ycontent = new Y.Map();
      yslide.set('content', ycontent);
    }
    const incByLang = {};
    for (const [lang, s] of Object.entries(slideByLang)) {
      incByLang[lang] = isPlainObject(s?.content) ? s.content : undefined;
    }
    let baseByLang = null;
    if (baseSlideByLang && !typeChanged) {
      baseByLang = {};
      for (const [lang, s] of Object.entries(baseSlideByLang)) {
        baseByLang[lang] = isPlainObject(s?.content) ? s.content : undefined;
      }
    }
    applyContentMap(ycontent, textFieldSpecForType(nextType, slideTypes), {
      dominant,
      incByLang,
      baseByLang,
      warnings,
      force: typeChanged,
      warnLabel: `slide ${sid}`,
    });
  }

  /** Delete removed languages' texts everywhere (title, notes, fields). */
  function removeLanguagesFromDoc(doc, langs) {
    const dropFromLangMap = (m) => {
      for (const l of langs) if (m.has(l)) m.delete(l);
    };
    // Self-describing walk: a Y.Map inside a content/item map is a lang
    // map; a Y.Map inside an items Y.Array is an item map.
    const walkContent = (container) => {
      for (const [, v] of container.entries()) {
        if (v instanceof Y.Map) dropFromLangMap(v);
        else if (v instanceof Y.Array) {
          for (const entry of v.toArray()) {
            if (entry instanceof Y.Map) walkContent(entry);
          }
        }
      }
    };
    const ytitle = doc.getMap('meta').get('title');
    if (ytitle instanceof Y.Map) dropFromLangMap(ytitle);
    for (const ys of doc.getArray('slides').toArray()) {
      if (!(ys instanceof Y.Map)) continue;
      const ynotes = ys.get('notes');
      if (ynotes instanceof Y.Map) dropFromLangMap(ynotes);
      const yc = ys.get('content');
      if (yc instanceof Y.Map) walkContent(yc);
    }
  }

  /** Top-level keys owned by meta.extra (everything except title/slides/i18n). */
  function extraOf(pres) {
    const extra = {};
    for (const [k, v] of Object.entries(isPlainObject(pres) ? pres : {})) {
      if (!PRES_SPECIAL_KEYS.has(k) && v !== undefined) extra[k] = deepClone(v);
    }
    return extra;
  }

  /** The i18n envelope minus versions/active, or null without an i18n block. */
  function i18nExtraOf(pres) {
    if (!isPlainObject(pres?.i18n)) return null;
    const out = {};
    for (const [k, v] of Object.entries(pres.i18n)) {
      if (k !== 'versions' && k !== 'active') out[k] = deepClone(v);
    }
    return out;
  }

  /**
   * Three-way key merge for plain JSON envelopes (meta.extra / meta.i18n):
   * overlay onto the doc's current object only the keys the caller changed
   * vs their base, preserving concurrently client-set keys.
   */
  function mergeEnvelope(docObj, baseObj, incObj) {
    const next = deepClone(isPlainObject(docObj) ? docObj : {});
    let changed = false;
    const keys = new Set([
      ...Object.keys(isPlainObject(baseObj) ? baseObj : {}),
      ...Object.keys(isPlainObject(incObj) ? incObj : {}),
    ]);
    for (const k of keys) {
      const bv = isPlainObject(baseObj) ? baseObj[k] : undefined;
      const iv = isPlainObject(incObj) ? incObj[k] : undefined;
      if (jsonEq(bv, iv)) continue;
      if (iv === undefined) {
        if (k in next) {
          delete next[k];
          changed = true;
        }
      } else if (!jsonEq(next[k], iv)) {
        next[k] = deepClone(iv);
        changed = true;
      }
    }
    return { changed, next };
  }

  /**
   * Apply a legacy presentation JSON onto an already-populated doc as a
   * structural diff (phase 2, step 4 — ADR 001 §6): slides matched by id,
   * fields by key, texts per language as Y.Text patches, items by index —
   * the Yjs twin of mergeSlidesAtSlideLevel.
   *
   * With `options.base` (the deck JSON the caller's write was based on —
   * the stored state just before this save) the diff is **three-way**: only
   * what the caller actually changed vs that base produces ops, so
   * concurrent client edits — which can run up to one persistence debounce
   * ahead of the stored JSON — survive on every field, slide, item and
   * language the caller didn't touch, and deletions only happen when the
   * base knew the thing being deleted. Without a base the incoming deck is
   * authoritative (full-replace, bootstrap-style normalization).
   *
   * Divergent language versions normalize to the dominant with the same
   * warnings as bootstrap; removed languages are reported loudly.
   *
   * Call inside the caller's transaction/origin (Yjs transactions nest);
   * the server seam uses Hocuspocus' `openDirectConnection().transact()`.
   *
   * @param {Object} pres - Presentation in the legacy JSON format
   * @param {Object} doc - A populated Y.Doc (see bootstrapPresentationToDoc)
   * @param {Object} [options]
   * @param {Object|null} [options.base] - Deck JSON the write was based on
   * @returns {{warnings: string[]}}
   */
  function applyPresentationToDoc(pres, doc, { base = null } = {}) {
    const warnings = [];
    const inc = resolveVersions(pres);
    const bas = base ? resolveVersions(base) : null;

    doc.transact(() => {
      const meta = doc.getMap('meta');
      const yslides = doc.getArray('slides');
      const docLangs = getDocLangs(doc);

      // Languages: removals are judged against the caller's base (a
      // language a client added in the write window survives); without a
      // base the incoming set is authoritative.
      const removedLangs = (bas ? bas.langs : docLangs).filter((l) => !inc.langs.includes(l));
      const removedSet = new Set(removedLangs);
      const nextLangs = docLangs.filter((l) => !removedSet.has(l));
      for (const l of inc.langs) if (!nextLangs.includes(l)) nextLangs.push(l);
      if (!jsonEq(nextLangs, docLangs)) meta.set('langs', nextLangs);
      if (removedLangs.length) {
        for (const l of removedLangs) {
          warnings.push(`language version '${l}' is not in the incoming deck — removed`);
        }
        removeLanguagesFromDoc(doc, removedLangs);
      }
      if ((!bas || bas.dominant !== inc.dominant) && inc.dominant !== getDocDominant(doc)) {
        meta.set('dominant', inc.dominant);
      }

      // Title per language.
      const titleValues = {};
      for (const l of inc.langs) titleValues[l] = inc.versions[l].title;
      let baseTitles = null;
      if (bas) {
        baseTitles = {};
        for (const l of bas.langs) baseTitles[l] = bas.versions[l].title;
      }
      applyTextField(meta, 'title', titleValues, baseTitles);

      // Top-level extras. Without a base: whole-object LWW. With a base:
      // per-key three-way merge, so concurrently client-set keys survive
      // (server-managed keys like revision always differ vs the base and
      // are always refreshed).
      const incExtra = extraOf(pres);
      if (!bas) {
        if (!jsonEq(incExtra, meta.get('extra'))) meta.set('extra', incExtra);
      } else {
        const { changed, next } = mergeEnvelope(meta.get('extra'), extraOf(base), incExtra);
        if (changed) meta.set('extra', next);
      }

      // i18n envelope minus versions/active (`active` is per-client state).
      const incI18n = i18nExtraOf(pres);
      if (!bas) {
        if (!jsonEq(incI18n, meta.get('i18n') ?? null)) meta.set('i18n', incI18n);
      } else {
        const baseI18n = i18nExtraOf(base);
        if (!jsonEq(incI18n, baseI18n)) {
          if (incI18n === null || !isPlainObject(meta.get('i18n'))) meta.set('i18n', incI18n);
          else {
            const { changed, next } = mergeEnvelope(meta.get('i18n'), baseI18n, incI18n);
            if (changed) meta.set('i18n', next);
          }
        }
      }

      // Slides. Per-language id → slide lookups on both sides.
      const idMapsFor = (rv) => {
        const byId = {};
        for (const l of rv.langs) {
          byId[l] = new Map(
            rv.versions[l].slides
              .filter((s) => isPlainObject(s) && typeof s.id === 'string' && s.id)
              .map((s) => [s.id, s])
          );
        }
        return byId;
      };
      const incById = idMapsFor(inc);
      const basById = bas ? idMapsFor(bas) : null;
      const viewFor = (byId, langsArr, id) => {
        const view = {};
        for (const l of langsArr) {
          const s = byId[l]?.get(id);
          if (s !== undefined) view[l] = s;
        }
        return view;
      };

      const target = inc.versions[inc.dominant].slides.filter(
        (s) => isPlainObject(s) && typeof s.id === 'string' && s.id
      );
      const targetIds = target.map((s) => s.id);
      const targetIdSet = new Set(targetIds);
      const baseIds = bas
        ? bas.versions[bas.dominant].slides
            .filter((s) => isPlainObject(s) && typeof s.id === 'string' && s.id)
            .map((s) => s.id)
        : null;
      const baseIdSet = baseIds ? new Set(baseIds) : null;

      // Ghost slides (only in a non-dominant version) are dropped — warn,
      // but in three-way mode only when they're new vs the base.
      for (const l of inc.langs) {
        if (l === inc.dominant) continue;
        for (const id of incById[l].keys()) {
          if (targetIdSet.has(id)) continue;
          const ghostInBase = bas ? basById[l]?.has(id) && !baseIdSet.has(id) : false;
          if (!ghostInBase) {
            warnings.push(
              `slide ${id} only exists in version '${l}' — dropped (structure follows '${inc.dominant}')`
            );
          }
        }
      }

      const yslideIdAt = (i) => {
        const s = yslides.get(i);
        return s instanceof Y.Map ? s.get('id') : undefined;
      };
      const findYSlide = (id) => {
        for (let i = 0; i < yslides.length; i += 1) {
          if (yslideIdAt(i) === id) return yslides.get(i);
        }
        return null;
      };

      // Deletions: without a base everything not incoming goes; with a
      // base only slides the caller actually removed (a slide a client
      // added in the write window survives).
      for (let i = yslides.length - 1; i >= 0; i -= 1) {
        const id = yslideIdAt(i);
        const remove = baseIdSet
          ? baseIdSet.has(id) && !targetIdSet.has(id)
          : !targetIdSet.has(id);
        if (remove) yslides.delete(i, 1);
      }

      // Order + inserts, only when the caller changed the structure
      // (clone-based moves, same as the client binder: Yjs types can't be
      // re-inserted). Client-added unknown slides drift towards the end on
      // a genuine server reorder, but always survive.
      const structureTouched = !baseIds || targetIds.join(' ') !== baseIds.join(' ');
      const insertedIds = new Set();
      if (structureTouched) {
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
            const clone = cloneYValue(yslides.get(j));
            yslides.delete(j, 1);
            yslides.insert(i, [clone]);
          } else if (!baseIdSet || !baseIdSet.has(targetIds[i])) {
            // Genuinely new slide: build it with every incoming language.
            const matches = [];
            for (const l of inc.langs) {
              if (l === inc.dominant) continue;
              const s = incById[l].get(targetIds[i]);
              if (isPlainObject(s)) matches.push({ lang: l, slide: s });
            }
            warnTypeDivergence(targetIds[i], target[i], matches, warnings);
            yslides.insert(i, [
              buildSlideYMap(target[i], { lang: inc.dominant, matches, warnings }),
            ]);
            insertedIds.add(targetIds[i]);
          }
          // else: the slide was in the caller's base but a client deleted
          // it concurrently — the deletion wins, don't resurrect it.
        }
        if (!baseIds) {
          while (yslides.length > targetIds.length) yslides.delete(targetIds.length, 1);
        }
      }

      // Field-level diff of every pre-existing slide, all languages.
      for (let i = 0; i < target.length; i += 1) {
        const id = targetIds[i];
        if (insertedIds.has(id)) continue;
        const slideByLang = viewFor(incById, inc.langs, id);
        const baseSlideByLang =
          bas && baseIdSet.has(id) ? viewFor(basById, bas.langs, id) : null;
        if (baseSlideByLang && jsonEq(slideByLang, baseSlideByLang)) continue; // untouched
        const yslide = findYSlide(id);
        if (!(yslide instanceof Y.Map)) continue; // concurrently deleted by a client
        applySlideYMap(yslide, {
          dominant: inc.dominant,
          slideByLang,
          baseSlideByLang,
          warnings,
        });
      }
    });
    return { warnings };
  }

  return {
    bootstrapPresentationToDoc,
    applyPresentationToDoc,
    projectDocToPresentation,
    getDocLangs,
    getDocDominant,
    /** Build one slide Y.Map from a single-language legacy slide. */
    buildSlideForLang: (slide, lang) => buildSlideYMap(slide, { lang }),
    /** Build an items field Y.Array from a single-language items array. */
    buildItemsForLang: (arr, spec, lang) =>
      buildItemsArray(Array.isArray(arr) ? arr : [], '', { dominantLang: lang, list: [] }, spec || EMPTY_SPEC),
    /** Build one item (Y.Map or plain passthrough) from a single-language item. */
    buildItemForLang: (item, spec, lang) =>
      buildItem(item, { dominantLang: lang, list: [] }, spec || EMPTY_SPEC),
    /** lang→Y.Text map holding one language's value. */
    buildTextFieldForLang: (value, lang) =>
      langTextMap({ [lang]: typeof value === 'string' ? value : '' }),
    projectSlideForLang: projectSlide,
    projectValueForLang: projectValue,
    cloneYValue,
    /** Translatable-field spec bound to this codec's slide-type registry. */
    textSpecForType: (type) => textFieldSpecForType(type, slideTypes),
  };
}
