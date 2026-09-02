/**
 * Translation status of a deck: which language version to read, what is still
 * missing in it, and the blank target a fill-job writes into.
 *
 * Shared, not server-only. It lived under `server/utils/translation-status.js`
 * while the only reader was the API; the editor chrome now asks the same
 * question ("how far along is the `de` version?"), and the answer may not be
 * computed twice with two spellings. Its one dependency, the text-field spec
 * in `slide-types/text-fields.js`, was already shared (B182/D72).
 *
 * The counters are **derived, never stored**. A deck used to carry
 * `i18n.progress` — two NL/EN-shaped numbers written on every save — which is
 * a cache of this module's output that could disagree with the versions beside
 * it. Schema step v10 -> v11 drops it.
 */
import {
  mapItemTexts,
  perLanguageKeys,
  textFieldSpecForType,
  valueAtPath,
} from './slide-types/text-fields.js';
import { normalizeLang, isNonEmptyString } from './i18n-utils.js';

function buildSlideIndex(slides) {
  const arr = Array.isArray(slides) ? slides : [];
  const byId = new Map();
  for (let i = 0; i < arr.length; i += 1) {
    const s = arr[i];
    if (s && typeof s === 'object' && typeof s.id === 'string' && s.id)
      byId.set(s.id, { slide: s, idx: i });
  }
  return { arr, byId };
}

/**
 * Scan one language version against another and list the text that is present
 * in the source but empty in the target.
 *
 * Walks the deck title plus every per-language field and item text, at every
 * nesting level — the same walk the translation merge uses, so a deck whose
 * only untranslated prose sits in `rows[].blocks[]` is not reported complete.
 *
 * @param {Object} [args]
 * @param {{title?: string, slides?: any[]}} [args.source] - the version read from
 * @param {{title?: string, slides?: any[]}} [args.target] - the version written to
 * @returns {{missingCount: number, missing: Array<Object>}}
 */
export function computeMissingTranslation({ source, target } = {}) {
  const srcTitle = source?.title;
  const tgtTitle = target?.title;
  const missing = [];

  if (isNonEmptyString(srcTitle) && !isNonEmptyString(tgtTitle)) {
    missing.push({ kind: 'deck', key: 'title' });
  }

  const srcIdx = buildSlideIndex(source?.slides);
  const tgtIdx = buildSlideIndex(target?.slides);

  for (let i = 0; i < srcIdx.arr.length; i += 1) {
    const s = srcIdx.arr[i];
    if (!s || typeof s !== 'object') continue;
    const type = typeof s.type === 'string' ? s.type : '';
    const spec = textFieldSpecForType(type);

    const srcContent =
      s.content && typeof s.content === 'object' ? s.content : {};

    // Prefer match by id, else fallback to same index.
    const match =
      (typeof s.id === 'string' && s.id && tgtIdx.byId.get(s.id)) || null;
    const t = match?.slide || tgtIdx.arr[i] || null;
    const tgtContent =
      t?.content && typeof t.content === 'object' ? t.content : {};
    const slideId = typeof s.id === 'string' ? s.id : '';

    // An undeclared string counts too: it is prose the type never declared
    // (a renamed key, a retired type), and prose the target version lacks is
    // a missing translation like any other (D79).
    const perLang = perLanguageKeys(spec, srcContent, tgtContent);
    if (!perLang.size && !spec.items.size) continue;

    for (const k of perLang) {
      const sv = srcContent[k];
      const tv = tgtContent[k];
      if (isNonEmptyString(sv) && !isNonEmptyString(tv)) {
        missing.push({
          kind: 'slide',
          slideId,
          slideIndex: i,
          type,
          key: k,
          path: [k],
        });
      }
    }

    // Item texts, at every nesting level. `mapItemTexts` is the same walk the
    // merge uses; a scan records paths and returns `undefined`, so the array
    // it rebuilds is thrown away.
    for (const [arrKey, itemSpec] of spec.items) {
      if (!Array.isArray(srcContent[arrKey])) continue;
      mapItemTexts(srcContent[arrKey], itemSpec, {
        path: [arrKey],
        resolve: (path, srcValue) => {
          const tv = valueAtPath(tgtContent, path);
          if (isNonEmptyString(srcValue) && !isNonEmptyString(tv)) {
            missing.push({
              kind: 'slide',
              slideId,
              slideIndex: i,
              type,
              key: path[path.length - 1],
              path,
            });
          }
          return undefined;
        },
      });
    }
  }

  return {
    missingCount: missing.length,
    missing,
  };
}

/**
 * The `{title, slides}` of one language version of a deck.
 *
 * Falls back to the deck's top-level fields when the version is absent or the
 * language is off-axis — those are kept aligned with the dominant version on
 * every write (`normalizeI18n`), so the fallback is the dominant version.
 *
 * @param {Object} [pres] - a presentation
 * @param {*} lang - the language version to read
 * @returns {{title: string, slides: any[]}}
 */
export function pickVersion(pres, lang) {
  const l = normalizeLang(lang);
  if (
    l &&
    pres?.i18n?.versions &&
    typeof pres.i18n.versions === 'object' &&
    pres.i18n.versions?.[l]
  ) {
    const v = pres.i18n.versions[l];
    return {
      title: typeof v?.title === 'string' ? v.title : '',
      slides: Array.isArray(v?.slides) ? v.slides : [],
    };
  }
  // Back-compat fallback to top-level
  return {
    title: typeof pres?.title === 'string' ? pres.title : '',
    slides: Array.isArray(pres?.slides) ? pres.slides : [],
  };
}

/**
 * A copy of a version with every translatable string emptied — the target a
 * fill-job starts from when the language does not exist yet.
 *
 * Item texts are blanked at every level too: leaving them as the source's prose
 * makes a fresh version look "already translated" to the missing-scan.
 *
 * @param {{title?: string, slides?: any[]}} source
 * @returns {{title: string, slides: any[]}}
 */
export function buildBlankTargetFromSource(source) {
  const slides = Array.isArray(source?.slides) ? source.slides : [];
  const outSlides = slides.map((s, idx) => {
    const type = typeof s?.type === 'string' ? s.type : '';
    const spec = textFieldSpecForType(type);
    const srcContent =
      s?.content && typeof s.content === 'object' ? s.content : {};
    const nextContent = { ...srcContent };
    // Undeclared strings are prose too, so they are blanked like any other:
    // carrying the source's wording over makes the fresh version look
    // translated to the missing-scan (D79).
    for (const k of perLanguageKeys(spec, srcContent)) nextContent[k] = '';
    // Item texts are blanked too, at every level. Leaving them as the source's
    // prose makes a fresh version look "already translated" to fillMissing.
    for (const [arrKey, itemSpec] of spec.items) {
      if (!Array.isArray(srcContent[arrKey])) continue;
      nextContent[arrKey] = mapItemTexts(srcContent[arrKey], itemSpec, {
        path: [arrKey],
        resolve: (_path, srcValue) =>
          typeof srcValue === 'string' ? '' : undefined,
      });
    }
    return {
      id: typeof s?.id === 'string' && s.id ? s.id : `missing-${idx}`,
      type,
      content: nextContent,
      notes: typeof s?.notes === 'string' ? s.notes : '',
    };
  });
  return { title: '', slides: outSlides };
}

/**
 * The deck languages this deck actually has a version for, normalized and
 * de-duplicated, in the order the versions were written.
 *
 * The one answer to "which languages does this deck offer" — the follow API's
 * `availableLangs`, the editor's language menu and the progress scan all read
 * it here. It used to be asked as `versions.nl` plus `versions['en-GB']`, which
 * is why a German version was invisible to every surface but the viewer.
 *
 * @param {Object} [pres] - a presentation
 * @returns {string[]}
 */
export function existingVersionLangs(pres) {
  const versions =
    pres?.i18n?.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};
  const out = [];
  for (const key of Object.keys(versions)) {
    if (!versions[key] || typeof versions[key] !== 'object') continue;
    const lang = normalizeLang(key);
    if (lang && !out.includes(lang)) out.push(lang);
  }
  return out;
}

/**
 * How far along every translation of a deck is, measured from the dominant
 * version outwards.
 *
 * `missing[lang]` is the number of translatable strings the dominant version
 * fills and `lang` does not, for **every existing version except the dominant
 * one** — that is the whole question, and it is answered where it is read
 * rather than cached on the deck (D72). The dominant version is the source, so
 * it never appears in the map.
 *
 * @param {Object} [pres] - a presentation
 * @returns {{dominant: string|null, missing: Record<string, number>}}
 */
export function translationProgress(pres) {
  const dominant =
    normalizeLang(pres?.i18n?.dominant) || normalizeLang(pres?.lang) || null;
  const missing = {};
  if (!dominant) return { dominant: null, missing };
  const source = pickVersion(pres, dominant);
  for (const lang of existingVersionLangs(pres)) {
    if (lang === dominant) continue;
    missing[lang] = computeMissingTranslation({
      source,
      target: pickVersion(pres, lang),
    }).missingCount;
  }
  return { dominant, missing };
}
