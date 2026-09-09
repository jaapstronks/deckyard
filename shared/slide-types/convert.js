import { SLIDE_TYPES, GLOBAL_SLIDE_FIELD_KEYS } from './registry.js';
import { seedAutoBackgroundPreset } from '../theme-background-presets.js';
import { normalizeLang } from '../i18n-utils.js';
import { resolveTypeDefaults } from './type-defaults.js';
import {
  IMAGE_TEXT_IMAGE_DEFAULTS,
  resolveImageTextImage,
} from './types/image-text-slide/image.js';
import { IMAGE_SET_IMAGE_DEFAULTS } from './types/image-set-slide/images.js';
import { resolveImageSlideImage } from './types/image-slide/image.js';

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

function defaultsForType(
  type,
  { slideTypes = SLIDE_TYPES, lang = null, theme = null } = {},
) {
  const def = slideTypes?.[type];
  if (!def) throw new Error(`Unknown slide type: ${type}`);
  // Same resolver the slide factory uses, so a converted slide is seeded from
  // the same skeleton a freshly created one of that type would get.
  return resolveTypeDefaults(def, normalizeLang(lang), theme);
}

function preserveGlobalFields({ fromContent, toContent }) {
  if (!fromContent || typeof fromContent !== 'object') return;
  if (!toContent || typeof toContent !== 'object') return;
  for (const k of GLOBAL_SLIDE_FIELD_KEYS) {
    if (fromContent[k] != null) toContent[k] = fromContent[k];
  }
}

/**
 * Carry the scalars that describe the image AREA rather than the image: they
 * mean the same thing on image-text and image-set, so a conversion between the
 * two keeps them instead of resetting to the target's defaults.
 * @param {Object} from - source content
 * @param {Object} to - target content (mutated)
 */
function carryImageAreaScalars(from, to) {
  for (const key of [
    'caption',
    'imageRole',
    'imageSide',
    'imageWidth',
    'imageBackground',
    'density',
    'asideVariant',
    'asideText',
  ]) {
    // Both types declare all eight, so no membership test is needed - only a
    // check that the source actually holds one.
    if (typeof from?.[key] === 'string') to[key] = from[key];
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
    'image-set-slide': ['layout'],
  },
  'image-text-slide': {
    // The image-area housekeeping enums ship as non-empty defaults, so without
    // this every conversion warned about them. Removing the image area is the
    // point of the conversion; image/caption/alt still warn when filled.
    'content-slide': [
      'imageRole',
      'imageSide',
      'imageWidth',
      'fit',
      'imageBackground',
      'focusX',
      'focusY',
    ],
    // The whole flat ImageRef becomes images[0] below, so none of its parts
    // is lost.
    'image-set-slide': ['image', 'alt', 'fit', 'focusX', 'focusY'],
  },
  'image-set-slide': {
    'content-slide': [
      'imageRole',
      'imageSide',
      'imageWidth',
      'imageBackground',
      // Text columns carry over conceptually (content-slide has its own
      // one/two-column layout enum), so the non-empty default never warns.
      'textColumns',
    ],
    // `images` is only PARTIALLY consumed on this route - see
    // PARTIALLY_CONSUMED_SOURCE_KEYS below.
    'image-text-slide': ['textColumns'],
  },
  'image-slide': {
    // The subheading is folded into the target's title/body below, because
    // image-text has no subheading field of its own. It travels, so it must
    // not warn. `bleed` does NOT travel: image-text does not render an
    // edge-to-edge frame, and carrying a key nothing reads is a hidden field
    // (D100). It is dropped deliberately, so it must not warn either.
    'image-text-slide': ['subheading', 'bleed'],
  },
  'list-slide': {
    'content-slide': ['variant', 'items'],
  },
};

/**
 * Source keys whose *remainder* is the loss: the conversion consumes part of
 * the value and what is left over is real content the target cannot hold.
 *
 * One entry today, and it is the reason the mechanism exists at all: a set's
 * `images[0]` becomes the single image of an image-text slide, so listing
 * `images` as consumed would silence exactly the boundary this seam is for -
 * the second and third image being dropped. The function returns the leftover
 * value; it is measured with the same `hasMeaningfulValue` as everything else,
 * so "meaningful" has one definition here.
 *
 * @type {Readonly<Record<string, Record<string, Record<string, (v: any) => any>>>>}
 */
const PARTIALLY_CONSUMED_SOURCE_KEYS = {
  'image-set-slide': {
    'image-text-slide': {
      images: (v) => (Array.isArray(v) ? v.slice(1) : []),
    },
  },
};

export function getConvertibleSlideTypes(
  slide,
  { slideTypes = SLIDE_TYPES } = {},
) {
  const type = String(slide?.type || '');
  if (!type || !slideTypes?.[type]) return [];
  if (type === 'content-slide') {
    return ['image-text-slide', 'image-set-slide'];
  }
  if (type === 'image-text-slide') return ['content-slide', 'image-set-slide'];
  if (type === 'image-set-slide') return ['content-slide', 'image-text-slide'];
  if (type === 'image-slide') return ['image-text-slide'];
  if (type === 'list-slide') {
    return ['content-slide'];
  }
  if (type === 'title-slide') return ['chapter-title-slide'];
  if (type === 'chapter-title-slide') return ['title-slide'];
  return [];
}

/**
 * The **AI Convert** pairs: which types an LLM is asked to restructure a slide
 * into, as opposed to the field-mapping conversion above.
 *
 * One source, two consumers. It used to be written out twice —
 * `AI_CONVERT_TARGETS` in the editor's header menu (with a hand-copied label
 * per target) and `SUPPORTED_CONVERSIONS` in
 * server/utils/openai/convert-slide.js — two hand-maintained maps of one fact,
 * the second of which silently decided what the first was allowed to offer.
 *
 * It lives here rather than on the types because a conversion is a relation
 * *between* two types, not a property of one, and because its other half — the
 * per-pair prompt — is core prose a fork type could not supply anyway. Same
 * shape and the same seam as the deterministic map above.
 *
 * Deliberately partial: most types have no meaningful restructuring target.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const AI_CONVERT_PAIRS = Object.freeze({
  'content-slide': [
    'list-slide',
    'icon-card-grid-slide',
    'text-blocks-slide',
    'kpi-metrics-slide',
  ],
  'list-slide': ['icon-card-grid-slide', 'content-slide', 'text-blocks-slide'],
  'icon-card-grid-slide': ['list-slide', 'content-slide', 'text-blocks-slide'],
  'text-blocks-slide': ['icon-card-grid-slide', 'list-slide'],
  'kpi-metrics-slide': ['content-slide', 'list-slide'],
});

/**
 * Which types the **AI Convert** submenu offers for this slide — the LLM
 * restructuring path, not the field-mapping conversion above.
 *
 * Read by both consumers: the editor menu
 * (client/views/editor/editor-form/header-actions.js) and the server route
 * that validates the request (server/utils/openai/convert-slide.js).
 *
 * Targets that are not registered are dropped, so a fork that removes a core
 * type does not leave a menu entry pointing at nothing.
 *
 * @param {{type?: string}|string} slide - a slide, or a type name
 * @param {Object} [opts]
 * @param {Object} [opts.slideTypes] - registry or `/api/slide-types` metadata
 * @returns {string[]}
 */
export function getAiConvertibleSlideTypes(
  slide,
  { slideTypes = SLIDE_TYPES } = {},
) {
  const type =
    typeof slide === 'string' ? slide : String(slide?.type || '').trim();
  if (!type || !slideTypes?.[type]) return [];
  return (AI_CONVERT_PAIRS[type] || []).filter(
    (name) => name !== type && !!slideTypes?.[name],
  );
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
  const partial = PARTIALLY_CONSUMED_SOURCE_KEYS?.[fromType]?.[targetType];
  const content =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};

  const extras = [];
  for (const k of fromKeys) {
    if (ignore.has(k)) continue;
    if (consumed.has(k)) continue;
    if (toKeys.has(k)) continue;
    const leftover = partial?.[k];
    if (leftover) {
      if (hasMeaningfulValue(leftover(content?.[k]))) extras.push(k);
      continue;
    }
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
    content: defaultsForType(targetType, { slideTypes, lang, theme }),
  };

  const from =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  const to = next.content;

  // Keep global cross-type fields (a11y, background image, logo) if present.
  preserveGlobalFields({ fromContent: from, toContent: to });
  // A converted slide is a new slide of the target type as far as the theme
  // is concerned: the target's declaration decides whether it takes a theme
  // background, and a background carried over above is never overwritten.
  seedAutoBackgroundPreset(to, slideTypes[targetType], theme);

  // Shared common keys where they overlap across these slide families.
  if (nonEmptyString(from.title) && typeof to.title === 'string')
    to.title = from.title;
  if (nonEmptyString(from.background) && typeof to.background === 'string')
    to.background = from.background;

  // content <-> image-text, content <-> image-set
  if (
    fromType === 'content-slide' &&
    (targetType === 'image-text-slide' || targetType === 'image-set-slide')
  ) {
    if (typeof from.body === 'string') to.body = from.body;
    // layout has no equivalent; keep target defaults.
  }
  if (
    (fromType === 'image-text-slide' || fromType === 'image-set-slide') &&
    targetType === 'content-slide'
  ) {
    if (typeof from.body === 'string') to.body = from.body;
  }

  // image-text <-> image-set: one flat ImageRef on one side, a 2-3 item set on
  // the other. Everything that is not the image itself is the same slide in
  // both directions - one story, one image area - so it travels as itself, and
  // `layout` deliberately does not: each type offers its own layouts, the
  // target's default applies, and a layout-switcher tile writes its own `set`
  // on top after the conversion.
  if (fromType === 'image-text-slide' && targetType === 'image-set-slide') {
    const { src, alt, fit, focusX, focusY } = resolveImageTextImage(from);
    const img = { src, alt };
    // Only a deviating fit is written: empty keeps meaning "follow the type".
    if (fit !== IMAGE_SET_IMAGE_DEFAULTS.fit) img.fit = fit;
    if (focusX !== '') img.focusX = focusX;
    if (focusY !== '') img.focusY = focusY;
    // A set holds at least two, so the second cell is opened empty.
    to.images = [img, { src: '', alt: '' }];
    carryImageAreaScalars(from, to);
    if (typeof from.body === 'string') to.body = from.body;
  }
  if (fromType === 'image-set-slide' && targetType === 'image-text-slide') {
    // The first image becomes the single image; the rest is dropped, which
    // getConversionLossyKeys names before the user confirms.
    const items = Array.isArray(from.images) ? from.images : [];
    const first = items[0] && typeof items[0] === 'object' ? items[0] : {};
    to.image = typeof first.src === 'string' ? first.src.trim() : '';
    to.alt = typeof first.alt === 'string' ? first.alt.trim() : '';
    if (
      (first.fit === 'cover' || first.fit === 'contain') &&
      first.fit !== IMAGE_TEXT_IMAGE_DEFAULTS.fit
    ) {
      to.fit = first.fit;
    }
    if (first.focusX != null && first.focusX !== '') to.focusX = first.focusX;
    if (first.focusY != null && first.focusY !== '') to.focusY = first.focusY;
    carryImageAreaScalars(from, to);
    if (typeof from.body === 'string') to.body = from.body;
  }

  // image -> image-text (one-way; reverse isn't offered)
  if (fromType === 'image-slide' && targetType === 'image-text-slide') {
    // Both types spell the single image the same way since D100, so the flat
    // ImageRef keys are written directly. Fit resolves through the image-slide
    // authority (own fit -> legacy `layout` -> type default) and is written
    // only when it deviates from the image-text default (empty keeps meaning
    // "follow the type"). `bleed` is deliberately DROPPED: image-text renders
    // no edge-to-edge frame, and a carried-but-unrendered key is a hidden
    // field (D100) - it is declared in CONSUMED_SOURCE_KEYS so it does not
    // warn either.
    if (typeof from.image === 'string' && from.image.trim())
      to.image = from.image.trim();
    if (typeof from.alt === 'string' && from.alt.trim())
      to.alt = from.alt.trim();
    if (from.focusX != null && from.focusX !== '') to.focusX = from.focusX;
    if (from.focusY != null && from.focusY !== '') to.focusY = from.focusY;
    const r = resolveImageSlideImage(from);
    if (r.fit !== IMAGE_TEXT_IMAGE_DEFAULTS.fit) to.fit = r.fit;
    if (typeof from.caption === 'string') to.caption = from.caption;
    if (typeof from.imageRole === 'string') to.imageRole = from.imageRole;

    // Title + body requirements:
    // - image-text requires title + body.
    // - image-slide title/subheading are optional, and image-text has no
    //   subheading field, so the subheading moves into the body.
    const srcTitle = nonEmptyString(from?.title) ? from.title.trim() : '';
    const srcSubheading = nonEmptyString(from?.subheading)
      ? from.subheading.trim()
      : '';
    const srcCaption = nonEmptyString(from?.caption) ? from.caption.trim() : '';
    if (srcTitle) to.title = srcTitle;
    else if (srcCaption) to.title = srcCaption.slice(0, 120);
    else if (srcSubheading) to.title = srcSubheading.slice(0, 120);
    else to.title = 'Image';

    // Prefer subheading as body; fall back to caption; otherwise keep it valid but minimal.
    if (srcSubheading) to.body = srcSubheading;
    else if (srcCaption) to.body = srcCaption;
    else to.body = '- ';
  }

  // list -> content (either name of the List type)
  if (isListType(fromType) && targetType === 'content-slide') {
    const items = Array.isArray(from?.items) ? from.items : [];
    const variant = from?.variant === 'numbers' ? 'numbers' : 'bullets';

    // Both types declare `subheading`, so it carries as itself instead of
    // being flattened into the body's first line.
    if (nonEmptyString(from?.subheading) && typeof to.subheading === 'string')
      to.subheading = from.subheading;

    const lines = [];
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
  }

  return next;
}
