import { SLIDE_TYPES, GLOBAL_SLIDE_FIELD_KEYS } from './registry.js';
import { TITLE_BG_PRESETS, pickRandom } from './helpers.js';
import { normalizeLang } from '../i18n-utils.js';

function deepClone(v) {
  return typeof structuredClone === 'function'
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v));
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
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
      'focusX',
      'focusY',
    ],
  },
  'lijstje-slide': {
    'content-slide': ['subtitle', 'variant', 'items'],
    'content-columns-slide': ['variant', 'layout', 'items'],
  },
  'card-stack-slide': {
    'icon-card-grid-slide': [
      'card1Title',
      'card2Title',
      'card3Title',
      'card4Title',
      // DEPRECATED: Remove after April 2026
      'card1Label',
      'card2Label',
      'card3Label',
      'card4Label',
    ],
  },
  'icon-card-grid-slide': {
    'card-stack-slide': [
      'card1Title',
      'card2Title',
      'card3Title',
      'card4Title',
    ],
  },
};

export function getConvertibleSlideTypes(slide, { slideTypes = SLIDE_TYPES } = {}) {
  const type = String(slide?.type || '');
  if (!type || !slideTypes?.[type]) return [];
  if (type === 'content-slide') {
    return ['image-text-slide'];
  }
  if (type === 'image-text-slide') return ['content-slide'];
  if (type === 'image-slide') return ['image-text-slide'];
  if (type === 'lijstje-slide') return ['content-slide', 'content-columns-slide'];
  if (type === 'card-stack-slide') return ['icon-card-grid-slide'];
  if (type === 'icon-card-grid-slide') return ['card-stack-slide'];
  if (type === 'title-slide') return ['chapter-title-slide'];
  if (type === 'chapter-title-slide') return ['title-slide'];
  return [];
}

export function getConversionLossyKeys(slide, toType, { slideTypes = SLIDE_TYPES } = {}) {
  const fromType = String(slide?.type || '');
  const targetType = String(toType || '');
  const allowed = new Set(getConvertibleSlideTypes(slide, { slideTypes }));
  if (!allowed.has(targetType)) return [];

  const fromDef = slideTypes?.[fromType];
  const toDef = slideTypes?.[targetType];
  if (!fromDef || !toDef) return [];

  const fromKeys = new Set(
    (fromDef.fields || []).map((f) => String(f?.key || '')).filter(Boolean)
  );
  const toKeys = new Set(
    (toDef.fields || []).map((f) => String(f?.key || '')).filter(Boolean)
  );
  const ignore = new Set(GLOBAL_SLIDE_FIELD_KEYS);
  const consumed = new Set(
    CONSUMED_SOURCE_KEYS?.[fromType]?.[targetType] || []
  );
  const content = slide?.content && typeof slide.content === 'object' ? slide.content : {};

  const extras = [];
  for (const k of fromKeys) {
    if (ignore.has(k)) continue;
    if (consumed.has(k)) continue;
    if (toKeys.has(k)) continue;
    if (hasMeaningfulValue(content?.[k])) extras.push(k);
  }
  return extras;
}

export function convertSlideToType(slide, toType, { slideTypes = SLIDE_TYPES, lang = null } = {}) {
  const fromType = String(slide?.type || '');
  const targetType = String(toType || '');
  if (!slide || typeof slide !== 'object') throw new Error('convertSlideToType: slide must be an object');
  if (!slideTypes?.[fromType]) throw new Error(`convertSlideToType: unknown fromType: ${fromType}`);
  if (!slideTypes?.[targetType]) throw new Error(`convertSlideToType: unknown toType: ${targetType}`);

  const allowed = new Set(getConvertibleSlideTypes(slide, { slideTypes }));
  if (!allowed.has(targetType)) {
    throw new Error(`convertSlideToType: unsupported conversion ${fromType} -> ${targetType}`);
  }

  const next = {
    ...slide,
    type: targetType,
    content: defaultsForType(targetType, { slideTypes, lang }),
  };

  const from = slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const to = next.content;

  // Keep global cross-type fields (a11y, background image, logo) if present.
  preserveGlobalFields({ fromContent: from, toContent: to });

  // Shared common keys where they overlap across these slide families.
  if (nonEmptyString(from.title) && typeof to.title === 'string') to.title = from.title;
  if (nonEmptyString(from.background) && typeof to.background === 'string') to.background = from.background;

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
    if (typeof from.image === 'string') to.image = from.image;
    if (typeof from.caption === 'string') to.caption = from.caption;
    if (typeof from.alt === 'string') to.alt = from.alt;
    if (typeof from.imageRole === 'string') to.imageRole = from.imageRole;
    if (from.focusX != null) to.focusX = from.focusX;
    if (from.focusY != null) to.focusY = from.focusY;

    // Layout mapping:
    // - full/bleed are "cover" (cropped)
    // - centered is "contain" (no crop)
    const layout = String(from?.layout || '').trim();
    to.imageFit = layout === 'centered' ? 'contain' : 'cover';

    // Title + body requirements:
    // - image-text requires title + body.
    // - image-slide title/subtitle are optional; move subtitle into body.
    const srcTitle = nonEmptyString(from?.title) ? from.title.trim() : '';
    const srcSubtitle = nonEmptyString(from?.subtitle) ? from.subtitle.trim() : '';
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

  // lijstje -> content
  if (fromType === 'lijstje-slide' && targetType === 'content-slide') {
    const subtitle =
      typeof from?.subtitle === 'string' ? from.subtitle.trim() : '';
    const items = Array.isArray(from?.items) ? from.items : [];
    const variant = from?.variant === 'numbers' ? 'numbers' : 'bullets';

    const lines = [];
    if (subtitle) lines.push(subtitle);
    for (let i = 0; i < Math.min(8, items.length); i += 1) {
      const it = items[i];
      const title =
        typeof it?.title === 'string' ? it.title.trim() : '';
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

  // lijstje -> content-columns
  if (fromType === 'lijstje-slide' && targetType === 'content-columns-slide') {
    // Copy subheading
    if (nonEmptyString(from?.subheading) && typeof to.subheading === 'string') {
      to.subheading = from.subheading;
    }

    const items = Array.isArray(from?.items) ? from.items : [];
    // content-columns supports up to 7 columns
    const columnCount = Math.max(1, Math.min(7, items.length));
    to.columnCount = String(columnCount);

    for (let i = 0; i < columnCount; i += 1) {
      const colNum = i + 1;
      const it = items[i];
      const itemTitle =
        typeof it?.title === 'string' ? it.title.trim() : '';
      const itemText =
        typeof it?.text === 'string'
          ? it.text.replace(/\s*\n+\s*/g, ' ').trim()
          : '';

      // List item title -> Column title block title
      to[`col${colNum}Title`] = itemTitle;
      to[`col${colNum}Text`] = '';
      to[`col${colNum}Image`] = '';
      to[`col${colNum}ImageFit`] = 'cover';
      to[`col${colNum}Alt`] = '';

      // List item text -> Block 1 title
      if (itemText) {
        to[`col${colNum}BlockCount`] = '1';
        to[`col${colNum}Block1Title`] = itemText;
        to[`col${colNum}Block1Body`] = '';
      } else {
        to[`col${colNum}BlockCount`] = '0';
      }
    }
  }

  // card-stack <-> icon-card-grid
  // Both now use cardNTitle for consistency
  if (fromType === 'card-stack-slide' && targetType === 'icon-card-grid-slide') {
    if (typeof from.subtitle === 'string' && typeof to.subtitle === 'string')
      to.subtitle = from.subtitle;
    const count = Math.max(1, Math.min(4, Number(from?.cardCount || 4) || 4));
    to.cardCount = String(count);
    for (let i = 1; i <= count; i += 1) {
      // DEPRECATED: cardNLabel fallback - Remove after April 2026
      const title = String(from?.[`card${i}Title`] || from?.[`card${i}Label`] || '').trim();
      const body = String(from?.[`card${i}Body`] || '').trim();
      to[`card${i}Title`] = title ? title.slice(0, 80) : '';
      to[`card${i}Body`] = body;
      // No icon in card-stack; leave empty.
      to[`card${i}Icon`] = '';
    }
  }
  if (fromType === 'icon-card-grid-slide' && targetType === 'card-stack-slide') {
    if (typeof from.subtitle === 'string' && typeof to.subtitle === 'string')
      to.subtitle = from.subtitle;
    const countRaw = Number(from?.cardCount || 4) || 4;
    const count = Math.max(1, Math.min(4, countRaw));
    to.cardCount = String(count);
    for (let i = 1; i <= count; i += 1) {
      const title = String(from?.[`card${i}Title`] || '').trim();
      const body = String(from?.[`card${i}Body`] || '').trim();
      // Now uses cardNTitle instead of cardNLabel
      to[`card${i}Title`] = title ? title.slice(0, 40) : '';
      to[`card${i}Body`] = body;
    }
  }

  // title <-> chapter-title
  if (fromType === 'title-slide' && targetType === 'chapter-title-slide') {
    to.title = nonEmptyString(from?.title) ? from.title : to.title;
  }
  if (fromType === 'chapter-title-slide' && targetType === 'title-slide') {
    to.title = nonEmptyString(from?.title) ? from.title : to.title;
    // Keep a nice default background image if the target has the key and it's empty.
    const hasBgKey = Object.prototype.hasOwnProperty.call(to, 'bgImage');
    const bg = hasBgKey && typeof to.bgImage === 'string' ? to.bgImage.trim() : '';
    if (hasBgKey && !bg) to.bgImage = pickRandom(TITLE_BG_PRESETS);
  }

  return next;
}
