import { SLIDE_TYPES, GLOBAL_SLIDE_FIELD_KEYS } from './registry.js';
import { pickBackgroundPreset } from '../theme-background-presets.js';
import { normalizeLang } from '../i18n-utils.js';
import { IMAGE_TEXT_IMAGE_DEFAULTS } from './types/image-text-slide/images.js';
import { resolveImageSlideImage } from './types/image-slide/image.js';

function deepClone(v) {
  return typeof structuredClone === 'function'
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v));
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * The List type. (Its retired Dutch alias was removed in the rung-3
 * consolidation; stored decks are migrated to `list-slide`.)
 */
function isListType(type) {
  return type === 'list-slide';
}

function defaultsForType(type, { slideTypes = SLIDE_TYPES, lang = null } = {}) {
  const def = slideTypes?.[type];
  if (!def) throw new Error(`Unknown slide type: ${type}`);
  const l = normalizeLang(lang);
  const byLang =
    l &&
    def.defaultsByLang &&
    typeof def.defaultsByLang === 'object' &&
    def.defaultsByLang[l] &&
    typeof def.defaultsByLang[l] === 'object'
      ? def.defaultsByLang[l]
      : null;
  return deepClone(byLang || def.defaults || {});
}

function preserveGlobalFields({ fromContent, toContent }) {
  if (!fromContent || typeof fromContent !== 'object') return;
  if (!toContent || typeof toContent !== 'object') return;
  for (const k of GLOBAL_SLIDE_FIELD_KEYS) {
    if (fromContent[k] != null) toContent[k] = fromContent[k];
  }
}

function hasMeaningfulValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.some((x) => hasMeaningfulValue(x));
  if (typeof v === 'object')
    return Object.values(v).some((x) => hasMeaningfulValue(x));
  return false;
}

// Keys that are intentionally "moved" during conversion, so the editor shouldn't warn
// about them being removed.
const CONSUMED_SOURCE_KEYS = {
  'content-slide': {
    // `layout` (one/two-column) has no image-text equivalent; the body flows
    // beside the image instead. Deliberate drop, not data loss worth a warning
    // - and the default 'one-column' would otherwise trigger the confirm on
    // every conversion.
    'image-text-slide': ['layout'],
  },
  'image-text-slide': {
    // The image-area housekeeping enums ship as non-empty defaults, so without
    // this every conversion warned about them. Removing the image area is the
    // point of the conversion; image/caption/alt still warn when filled.
    'content-slide': [
      'imageRole',
      'imageSide',
      'imageWidth',
      'imageFit',
      'imageBackground',
      // Text columns carry over conceptually (content-slide has its own
      // one/two-column layout enum), so the non-empty default never warns.
      'textColumns',
      'focusX',
      'focusY',
    ],
  },
  'list-slide': {
    'content-slide': ['subtitle', 'variant', 'items'],
  },
};

export function getConvertibleSlideTypes(
  slide,
  { slideTypes = SLIDE_TYPES } = {},
) {
  const type = String(slide?.type || '');
  if (!type || !slideTypes?.[type]) return [];
  if (type === 'content-slide') {
    return ['image-text-slide'];
  }
  if (type === 'image-text-slide') return ['content-slide'];
  if (type === 'image-slide') return ['image-text-slide'];
  if (type === 'list-slide') {
    return ['content-slide'];
  }
  if (type === 'title-slide') return ['chapter-title-slide'];
  if (type === 'chapter-title-slide') return ['title-slide'];
  return [];
}

export function getConversionLossyKeys(
  slide,
  toType,
  { slideTypes = SLIDE_TYPES } = {},
) {
  const fromType = String(slide?.type || '');
  const targetType = String(toType || '');
  const allowed = new Set(getConvertibleSlideTypes(slide, { slideTypes }));
  if (!allowed.has(targetType)) return [];

  const fromDef = slideTypes?.[fromType];
  const toDef = slideTypes?.[targetType];
  if (!fromDef || !toDef) return [];

  const fromKeys = new Set(
    (fromDef.fields || []).map((f) => String(f?.key || '')).filter(Boolean),
  );
  const toKeys = new Set(
    (toDef.fields || []).map((f) => String(f?.key || '')).filter(Boolean),
  );
  const ignore = new Set(GLOBAL_SLIDE_FIELD_KEYS);
  const consumed = new Set(
    CONSUMED_SOURCE_KEYS?.[fromType]?.[targetType] || [],
  );
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};

  const extras = [];
  for (const k of fromKeys) {
    if (ignore.has(k)) continue;
    if (consumed.has(k)) continue;
    if (toKeys.has(k)) continue;
    if (hasMeaningfulValue(content?.[k])) extras.push(k);
  }
  return extras;
}

export function convertSlideToType(
  slide,
  toType,
  { slideTypes = SLIDE_TYPES, lang = null, theme = null } = {},
) {
  const fromType = String(slide?.type || '');
  const targetType = String(toType || '');
  if (!slide || typeof slide !== 'object')
    throw new Error('convertSlideToType: slide must be an object');
  if (!slideTypes?.[fromType])
    throw new Error(`convertSlideToType: unknown fromType: ${fromType}`);
  if (!slideTypes?.[targetType])
    throw new Error(`convertSlideToType: unknown toType: ${targetType}`);

  const allowed = new Set(getConvertibleSlideTypes(slide, { slideTypes }));
  if (!allowed.has(targetType)) {
    throw new Error(
      `convertSlideToType: unsupported conversion ${fromType} -> ${targetType}`,
    );
  }

  const next = {
    ...slide,
    type: targetType,
    content: defaultsForType(targetType, { slideTypes, lang }),
  };

  const from =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const to = next.content;

  // Keep global cross-type fields (a11y, background image, logo) if present.
  preserveGlobalFields({ fromContent: from, toContent: to });

  // Shared common keys where they overlap across these slide families.
  if (nonEmptyString(from.title) && typeof to.title === 'string')
    to.title = from.title;
  if (nonEmptyString(from.background) && typeof to.background === 'string')
    to.background = from.background;

  // content <-> image-text
  if (fromType === 'content-slide' && targetType === 'image-text-slide') {
    if (typeof from.body === 'string') to.body = from.body;
    // layout has no equivalent; keep target defaults.
  }
  if (fromType === 'image-text-slide' && targetType === 'content-slide') {
    if (typeof from.body === 'string') to.body = from.body;
  }

  // image -> image-text (one-way; reverse isn't offered)
  if (fromType === 'image-slide' && targetType === 'image-text-slide') {
    // alt + focus + fit + bleed are canonical on images[0] (the ImageRef).
    // Fit/bleed resolve through the image-slide authority (own fit/bleed ->
    // legacy `layout` -> type default); only values deviating from the
    // image-text default are written (empty keeps meaning "follow the type").
    // `bleed` travels losslessly as an ImageRef property image-text does not
    // render yet - nothing is guessed away, so a reverse conversion stays
    // possible.
    const img = { src: '', alt: '' };
    if (typeof from.image === 'string' && from.image.trim())
      img.src = from.image.trim();
    if (typeof from.alt === 'string' && from.alt.trim())
      img.alt = from.alt.trim();
    if (from.focusX != null && from.focusX !== '') img.focusX = from.focusX;
    if (from.focusY != null && from.focusY !== '') img.focusY = from.focusY;
    const r = resolveImageSlideImage(from);
    if (r.fit !== IMAGE_TEXT_IMAGE_DEFAULTS.fit) img.fit = r.fit;
    if (r.bleed) img.bleed = true;
    if (
      img.src ||
      img.alt ||
      'focusX' in img ||
      'focusY' in img ||
      'fit' in img ||
      'bleed' in img
    ) {
      to.images = [img];
    }
    if (typeof from.caption === 'string') to.caption = from.caption;
    if (typeof from.imageRole === 'string') to.imageRole = from.imageRole;

    // Title + body requirements:
    // - image-text requires title + body.
    // - image-slide title/subtitle are optional; move subtitle into body.
    const srcTitle = nonEmptyString(from?.title) ? from.title.trim() : '';
    const srcSubtitle = nonEmptyString(from?.subtitle)
      ? from.subtitle.trim()
      : '';
    const srcCaption = nonEmptyString(from?.caption) ? from.caption.trim() : '';
    if (srcTitle) to.title = srcTitle;
    else if (srcCaption) to.title = srcCaption.slice(0, 120);
    else if (srcSubtitle) to.title = srcSubtitle.slice(0, 120);
    else to.title = 'Image';

    // Prefer subtitle as body; fall back to caption; otherwise keep it valid but minimal.
    if (srcSubtitle) to.body = srcSubtitle;
    else if (srcCaption) to.body = srcCaption;
    else to.body = '- ';
  }

  // list -> content (either name of the List type)
  if (isListType(fromType) && targetType === 'content-slide') {
    const subtitle =
      typeof from?.subtitle === 'string' ? from.subtitle.trim() : '';
    const items = Array.isArray(from?.items) ? from.items : [];
    const variant = from?.variant === 'numbers' ? 'numbers' : 'bullets';

    const lines = [];
    if (subtitle) lines.push(subtitle);
    for (let i = 0; i < Math.min(8, items.length); i += 1) {
      const it = items[i];
      const title = typeof it?.title === 'string' ? it.title.trim() : '';
      const text =
        typeof it?.text === 'string'
          ? it.text.replace(/\s*\n+\s*/g, ' ').trim()
          : '';
      const bullet = variant === 'numbers' ? `${i + 1}.` : '-';
      lines.push(`${bullet} ${title || '…'}`);
      if (text) lines.push(text);
    }
    const body = lines.join('\n');
    if (typeof to.body === 'string') to.body = body;
    if (typeof to.layout === 'string') to.layout = 'one-column';
  }

  // title <-> chapter-title. Both share `title` + `subheading`, so those carry
  // across losslessly; the title slide's `meta` has no chapter equivalent and
  // drops (a filled meta warns via getConversionLossyKeys).
  if (fromType === 'title-slide' && targetType === 'chapter-title-slide') {
    to.title = nonEmptyString(from?.title) ? from.title : to.title;
    if (nonEmptyString(from?.subheading)) to.subheading = from.subheading;
  }
  if (fromType === 'chapter-title-slide' && targetType === 'title-slide') {
    to.title = nonEmptyString(from?.title) ? from.title : to.title;
    if (nonEmptyString(from?.subheading)) to.subheading = from.subheading;
    // Give the target a background from the theme's own presets when it has
    // none. Canonical key is slideBgImage. No theme (or no presets) leaves it
    // flat.
    const bg =
      typeof to.slideBgImage === 'string' ? to.slideBgImage.trim() : '';
    if (!bg) {
      const preset = pickBackgroundPreset(theme);
      if (preset) to.slideBgImage = preset;
    }
  }

  return next;
}
