import {
  mapItemTexts,
  textFieldSpecForType,
  valueAtPath,
} from '../../shared/slide-types/text-fields.js';
import {
  normalizeLang,
  otherLang,
  isNonEmptyString,
} from '../../shared/i18n-utils.js';

export { normalizeLang, otherLang };

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
    if (!spec.textKeys.size && !spec.items.size) continue;

    const srcContent =
      s.content && typeof s.content === 'object' ? s.content : {};

    // Prefer match by id, else fallback to same index.
    const match =
      (typeof s.id === 'string' && s.id && tgtIdx.byId.get(s.id)) || null;
    const t = match?.slide || tgtIdx.arr[i] || null;
    const tgtContent =
      t?.content && typeof t.content === 'object' ? t.content : {};
    const slideId = typeof s.id === 'string' ? s.id : '';

    for (const k of spec.textKeys) {
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

export function buildBlankTargetFromSource(source) {
  const slides = Array.isArray(source?.slides) ? source.slides : [];
  const outSlides = slides.map((s, idx) => {
    const type = typeof s?.type === 'string' ? s.type : '';
    const spec = textFieldSpecForType(type);
    const srcContent =
      s?.content && typeof s.content === 'object' ? s.content : {};
    const nextContent = { ...srcContent };
    for (const k of spec.textKeys) nextContent[k] = '';
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
