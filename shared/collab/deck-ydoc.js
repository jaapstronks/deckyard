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
    if (f.type === 'string' || f.type === 'markdown') spec.textKeys.add(key);
    else if (f.type === 'items' && Array.isArray(f.itemFields)) {
      spec.items.set(key, specForFields(f.itemFields));
    }
  }
  return spec;
}

const EMPTY_SPEC = { textKeys: new Set(), items: new Map() };

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
 *   projectDocToPresentation: (doc: Object) => Object,
 *   getDocLangs: (doc: Object) => string[],
 *   getDocDominant: (doc: Object) => string,
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
   * Bootstrap an (empty) Y.Doc from a legacy presentation JSON.
   * @param {Object} pres - Presentation in the legacy JSON format
   * @param {Object} doc - A fresh Y.Doc to populate
   * @returns {{warnings: string[]}} Lossy-normalization notes (dropped
   *   slides, type mismatches); empty when the versions were in sync.
   */
  function bootstrapPresentationToDoc(pres, doc) {
    const warnings = [];

    // Resolve language versions. Without an i18n block the deck is a
    // single-language world keyed by pres.lang.
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
    const langs = Object.keys(versions);
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
          if (k !== 'versions') i18nExtra[k] = deepClone(v);
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

        const ymap = new Y.Map();
        ymap.set('id', sid);
        ymap.set('type', typeof slide.type === 'string' ? slide.type : '');

        // Notes are per-language.
        const notesValues = {};
        if (typeof slide.notes === 'string') notesValues[dominant] = slide.notes;
        for (const { lang, slide: peer } of matches) {
          if (typeof peer.notes === 'string') notesValues[lang] = peer.notes;
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
            if (typeof content[key] === 'string') values[dominant] = content[key];
            for (const { lang, slide: peer } of matches) {
              const v = textAt(peer, key);
              if (typeof v === 'string') values[lang] = v;
            }
            if (Object.keys(values).length) ycontent.set(key, langTextMap(values));
            // Schema says text but the value isn't a string: keep as plain.
            else if (content[key] !== undefined) ycontent.set(key, deepClone(content[key]));
            continue;
          }
          const itemSpec = spec.items.get(key);
          if (itemSpec && Array.isArray(content[key])) {
            const peers = {
              dominantLang: dominant,
              list: matches.map(({ lang, slide: peer }) => ({
                lang,
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
            for (const { lang, slide: peer } of matches) {
              const pv = peer?.content?.[key];
              if (pv !== undefined && JSON.stringify(pv) !== dominantJson) {
                warnings.push(`slide ${sid}: plain field '${key}' differs in version '${lang}' — dominant wins`);
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
      pres.i18n = { ...deepClone(i18nExtra), versions };
    }
    return pres;
  }

  return {
    bootstrapPresentationToDoc,
    projectDocToPresentation,
    getDocLangs,
    getDocDominant,
  };
}
