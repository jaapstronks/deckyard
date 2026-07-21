import cardStackSlide from './types/card-stack-slide.js';
import chapterTitleSlide from './types/chapter-title-slide.js';
import contentSlide from './types/content-slide.js';
import freeformSlide from './types/freeform-slide.js';
import iconCardGridSlide from './types/icon-card-grid-slide.js';
import imageSlide from './types/image-slide.js';
import imageTextSlide from './types/image-text-slide.js';
import lijstjeSlide from './types/lijstje-slide.js';
import listSlide from './types/list-slide.js';
import endSlide from './types/end-slide.js';
import payoffSlide from './types/payoff-slide.js';
import quoteSlide from './types/quote-slide.js';
import splitPartnerTitleSlide from './types/split-partner-title-slide.js';
import teamCardsSlide from './types/team-cards-slide.js';
import logoWallSlide from './types/logo-wall-slide.js';
import titleSlide from './types/title-slide.js';
import videoSlide from './types/video-slide.js';
import embedSlide from './types/embed-slide.js';
import countdownSlide from './types/countdown-slide.js';
import pollSlide from './types/poll-slide.js';
import likertSlide from './types/likert-slide.js';
import likertSliderSlide from './types/likert-slider-slide.js';
import followInviteSlide from './types/follow-invite-slide.js';
import chartSlide from './types/chart-slide.js';
import feedbackSlide from './types/feedback-slide.js';
import leadCaptureSlide from './types/lead-capture-slide.js';
import tableSlide from './types/table-slide.js';
import kpiMetricsSlide from './types/kpi-metrics-slide.js';
import textBlocksSlide from './types/text-blocks-slide.js';
import contentColumnsSlide from './types/content-columns-slide.js';
import comparisonSlide from './types/comparison-slide.js';
import processSlide from './types/process-slide.js';
import timelineSlide from './types/timeline-slide.js';
import matrixSlide from './types/matrix-slide.js';
import funnelSlide from './types/funnel-slide.js';
import pyramidSlide from './types/pyramid-slide.js';
import cycleSlide from './types/cycle-slide.js';
import gallerySlide from './types/gallery-slide.js';
import customHtmlSlide from './types/custom-html-slide.js';
import { addUiI18nKeysToSlideType } from '../ui-i18n-keys.js';
import { DEFAULT_THEME_ID } from '../constants/themes.js';
import {
  CORE_NAMESPACE,
  formatTypeId,
  tryParseTypeId,
} from './type-id.js';

// A fork namespace segment must be kebab-safe; anything else falls back to
// the generic `custom` namespace so a malformed declaration can't produce an
// invalid type id.
const NAMESPACE_SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_CUSTOM_NAMESPACE = 'custom';

// Detect if we're running in Node.js (has process.versions.node)
const isNode = typeof process !== 'undefined' && process.versions?.node;

// Canonical list of content keys that withGlobalSlideFields() adds to every
// slide type. Kept here as the single source of truth so other layers
// (slide conversion, AI/MCP specs) can reference the same set without drift.
export const GLOBAL_SLIDE_FIELD_KEYS = [
  'a11yTitle',
  'a11ySummary',
  'slideBgImage',
  'slideBgFit',
  'slideBgFocusX',
  'slideBgFocusY',
  'slideBgOverlay',
  'slideBgText',
  'slideLogo',
];

function withGlobalSlideFields(def) {
  const d = def && typeof def === 'object' ? def : {};
  const fields = Array.isArray(d.fields) ? d.fields : [];
  const has = new Set(fields.map((f) => String(f?.key || '')));
  const extra = [];
  if (!has.has('a11yTitle')) {
    extra.push({
      key: 'a11yTitle',
      type: 'string',
      label: 'Accessibility title',
      placeholder: 'Optional',
      helpText:
        'Optional. Screen readers announce this when the slide becomes active. Prefer a short, descriptive phrase.',
      maxLength: 140,
    });
  }
  if (!has.has('a11ySummary')) {
    extra.push({
      key: 'a11ySummary',
      type: 'string',
      label: 'Accessibility summary',
      placeholder: 'Optional',
      helpText:
        'Optional extra context for screen readers (announced after the title). Keep it brief.',
      maxLength: 280,
    });
  }
  // Optional per-slide background image, available on every slide type.
  // Rendered centrally in renderSlideHtml() as a layer behind the slide content,
  // so individual slide-type renderers don't need to know about it.
  if (!has.has('slideBgImage')) {
    extra.push({
      key: 'slideBgImage',
      type: 'image',
      label: 'Background image',
      required: false,
      presetSource: 'backgrounds',
      helpText:
        'Optional. Fills the whole slide behind the content. Large images are resized automatically; use the focus control to pick which part stays visible when cropped.',
    });
  }
  if (!has.has('slideBgFit')) {
    extra.push({
      key: 'slideBgFit',
      type: 'enum',
      label: 'Background fit',
      required: false,
      options: [
        { value: 'cover', label: 'Fill (crop)' },
        { value: 'contain', label: 'Fit (no crop)' },
      ],
    });
  }
  if (!has.has('slideBgFocusX')) {
    extra.push({
      key: 'slideBgFocusX',
      type: 'number',
      label: 'Background focus X',
      required: false,
    });
  }
  if (!has.has('slideBgFocusY')) {
    extra.push({
      key: 'slideBgFocusY',
      type: 'number',
      label: 'Background focus Y',
      required: false,
    });
  }
  if (!has.has('slideBgOverlay')) {
    extra.push({
      key: 'slideBgOverlay',
      type: 'enum',
      label: 'Background overlay',
      required: false,
      options: [
        { value: 'auto', label: 'Auto (only if needed)' },
        { value: 'none', label: 'None' },
        { value: 'light', label: 'Light scrim' },
        { value: 'dark', label: 'Dark scrim' },
        { value: 'gradient-top', label: 'Gradient (top)' },
        { value: 'gradient-bottom', label: 'Gradient (bottom)' },
      ],
      helpText:
        'Auto adds a subtle scrim only when the image is too busy for readable text. Gradient options darken one edge behind the text.',
    });
  }
  if (!has.has('slideBgText')) {
    extra.push({
      key: 'slideBgText',
      type: 'enum',
      label: 'Text colour',
      required: false,
      options: [
        { value: 'auto', label: 'Auto (detect)' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      helpText:
        'Auto picks the theme text colour with the best contrast for the background image. Light/dark force it. (Legacy "default" is treated as the theme default.)',
    });
  }
  // Optional per-slide theme logo in a corner. Uses the logo defined by the
  // active theme (theme.assets.logo); rendered centrally in renderSlideHtml.
  if (!has.has('slideLogo')) {
    extra.push({
      key: 'slideLogo',
      type: 'enum',
      label: 'Theme logo',
      required: false,
      options: [
        { value: 'none', label: 'Off' },
        { value: 'top-right', label: 'Top right' },
      ],
      helpText: 'Show the active theme logo in a corner of this slide.',
    });
  }
  if (!extra.length) return d;
  return { ...d, fields: [...fields, ...extra] };
}

// Core slide types (always available in OSS version)
const CORE_SLIDE_TYPES = {
  'title-slide': titleSlide,
  'chapter-title-slide': chapterTitleSlide,
  'content-slide': contentSlide,
  'table-slide': tableSlide,
  'list-slide': listSlide,
  'lijstje-slide': lijstjeSlide, // Back-compat alias (same definition as list-slide)
  'kpi-metrics-slide': kpiMetricsSlide,
  'split-partner-title-slide': splitPartnerTitleSlide,
  'image-text-slide': imageTextSlide,
  'video-slide': videoSlide,
  'team-cards-slide': teamCardsSlide,
  'logo-wall-slide': logoWallSlide,
  'card-stack-slide': cardStackSlide,
  'icon-card-grid-slide': iconCardGridSlide,
  'payoff-slide': payoffSlide,
  'quote-slide': quoteSlide,
  'image-slide': imageSlide,
  'embed-slide': embedSlide,
  'countdown-slide': countdownSlide,
  'poll-slide': pollSlide,
  'likert-slide': likertSlide,
  'likert-slider-slide': likertSliderSlide,
  'feedback-slide': feedbackSlide,
  'lead-capture-slide': leadCaptureSlide,
  'follow-invite-slide': followInviteSlide,
  'chart-slide': chartSlide,
  'text-blocks-slide': textBlocksSlide,
  'content-columns-slide': contentColumnsSlide,
  'comparison-slide': comparisonSlide,
  'process-slide': processSlide,
  'timeline-slide': timelineSlide,
  'matrix-slide': matrixSlide,
  'funnel-slide': funnelSlide,
  'pyramid-slide': pyramidSlide,
  'cycle-slide': cycleSlide,
  'gallery-slide': gallerySlide,
  'freeform-slide': freeformSlide,
  'custom-html-slide': customHtmlSlide,
  'end-slide': endSlide,
};

// Load custom slide types from /custom/slide-types/ directory (server-only)
// Custom types are loaded at startup and override core types if same name
// Browser builds skip this since they can't access the filesystem
let customTypes = {};
if (isNode) {
  const { loadCustomSlideTypes } = await import('./custom-loader.js');
  customTypes = await loadCustomSlideTypes();
}

/**
 * Merge core and custom slide types with collision detection.
 *
 * A custom type may NOT silently shadow a core type: doing so by accident is
 * exactly how a fork ends up quietly replacing core behaviour. To replace a
 * core type on purpose, the custom definition must opt in with `override: true`
 * (optionally `overrides: 'core/<name>'` for documentation). Without the flag
 * the core type is kept and a prominent warning is logged, so the shadow is
 * never silent.
 *
 * @param {Record<string, object>} core
 * @param {Record<string, object>} custom
 * @returns {Record<string, object>}
 */
export function mergeSlideTypes(core, custom) {
  const merged = { ...core };
  for (const [name, def] of Object.entries(custom)) {
    const shadowsCore = Object.prototype.hasOwnProperty.call(core, name);
    if (shadowsCore && !def?.override) {
      console.warn(
        `[registry] Custom slide type "${name}" would shadow the core type ` +
          `"${name}" but does not declare "override: true" — keeping core. ` +
          `Rename the custom type, or set override:true to replace core on purpose.`
      );
      continue; // core wins; the shadow is refused, not applied silently
    }
    if (shadowsCore) {
      console.log(
        `[registry] Custom slide type "${name}" intentionally overrides core (override:true).`
      );
    }
    merged[name] = def;
  }
  return merged;
}

// Merge core and custom types. Custom types are additive; a core-name collision
// is only honoured with an explicit override flag (see mergeSlideTypes).
const RAW_SLIDE_TYPES = mergeSlideTypes(CORE_SLIDE_TYPES, customTypes);

// Names of custom types that were REFUSED because they collided with core
// without an override flag. Kept so CUSTOM_SLIDE_TYPE_NAMES stays accurate
// (a refused type did not enter the registry).
const APPLIED_CUSTOM_NAMES = Object.keys(customTypes).filter(
  (name) =>
    !Object.prototype.hasOwnProperty.call(CORE_SLIDE_TYPES, name) ||
    customTypes[name]?.override
);

export const SLIDE_TYPES = Object.fromEntries(
  Object.entries(RAW_SLIDE_TYPES).map(([type, def]) => [
    type,
    addUiI18nKeysToSlideType(type, withGlobalSlideFields(def)),
  ])
);

// Names of types that came from custom/slide-types/ AND actually entered the
// registry (a core-colliding type refused for lack of an override flag did
// not). Tooling that produces tracked artifacts (e.g. i18n extraction) skips
// these so a locally-installed fork customization can't leak into upstream files.
export const CUSTOM_SLIDE_TYPE_NAMES = APPLIED_CUSTOM_NAMES;

// ---------------------------------------------------------------------------
// Slide-type identity (namespace/name[@version]) — see ./type-id.js.
//
// The registry key stays the bare local name so every existing
// `SLIDE_TYPES[slide.type]` lookup and stored `slide.type` keep working. The
// namespace/version is an ADDED identity layer exposed alongside the map, not
// baked into the def objects (so generated schema/docs/API output are
// unaffected).
// ---------------------------------------------------------------------------

/**
 * Structured identity for a registered type name.
 * Core types resolve to the `core` namespace; applied custom types take their
 * declared `namespace`/`version` (falling back to the `custom` namespace).
 * @param {string} name
 * @returns {import('./type-id.js').TypeId}
 */
function slideTypeIdentityFor(name) {
  const custom = customTypes[name];
  const isAppliedCustom = APPLIED_CUSTOM_NAMES.includes(name);
  if (custom && isAppliedCustom) {
    const declared = typeof custom.namespace === 'string' ? custom.namespace : '';
    const namespace = NAMESPACE_SEGMENT_RE.test(declared)
      ? declared
      : DEFAULT_CUSTOM_NAMESPACE;
    return {
      namespace,
      name,
      version: custom.version != null ? String(custom.version) : null,
    };
  }
  const coreDef = CORE_SLIDE_TYPES[name];
  return {
    namespace: CORE_NAMESPACE,
    name,
    version: coreDef?.version != null ? String(coreDef.version) : null,
  };
}

/**
 * Canonical `namespace/name[@version]` id per registered type name.
 * @type {Record<string, string>}
 */
export const SLIDE_TYPE_IDS = Object.fromEntries(
  Object.keys(SLIDE_TYPES).map((name) => [
    name,
    formatTypeId(slideTypeIdentityFor(name)),
  ])
);

/**
 * The canonical id for a registered type name, or undefined if unknown.
 * @param {string} name
 * @returns {string|undefined}
 */
export function getSlideTypeId(name) {
  return SLIDE_TYPE_IDS[name];
}

/**
 * Resolve a slide-type reference to its definition. Accepts the bare local key
 * (`"title-slide"`), or a qualified id (`"core/title-slide"`, `"title-slide@2"`,
 * `"acme/hero"`). Namespace/version are advisory at resolution time — the
 * registry key is the local name and collision detection at load guarantees one
 * definition per name — so a qualified ref resolves by its `name` segment.
 *
 * @param {string} ref
 * @param {Record<string, object>} [slideTypes] - registry to resolve against
 *   (defaults to SLIDE_TYPES; pass a custom map through the same seam).
 * @returns {object|undefined}
 */
export function getSlideType(ref, slideTypes = SLIDE_TYPES) {
  if (typeof ref !== 'string' || !ref) return undefined;
  if (Object.prototype.hasOwnProperty.call(slideTypes, ref)) {
    return slideTypes[ref];
  }
  const id = tryParseTypeId(ref);
  if (!id) return undefined;
  return slideTypes[id.name];
}

/**
 * Build the deck-level manifest of slide-type identities a set of slides uses:
 * `{ [bareTypeName]: "namespace/name[@version]" }`. Recomputed from the current
 * registry so it never drifts. Stamped onto the portable deck export so a deck
 * records which type definitions it was written against.
 *
 * @param {Array<{type?: string}>} slides
 * @returns {Record<string, string>}
 */
export function collectSlideTypeManifest(slides) {
  const manifest = {};
  for (const slide of Array.isArray(slides) ? slides : []) {
    const name = slide?.type;
    if (typeof name !== 'string' || !name || manifest[name]) continue;
    manifest[name] =
      SLIDE_TYPE_IDS[name] ||
      formatTypeId({ namespace: CORE_NAMESPACE, name, version: null });
  }
  return manifest;
}

// Core themes included with the OSS version.
// Additional themes can be added via custom/themes/ directory.
// Note: Themes are discovered dynamically at runtime from /themes/*.json and /custom/themes/*.json
export const THEMES = [
  DEFAULT_THEME_ID,
  // Neutral, non-branded base themes covering the common archetypes.
  'corporate',
  'editorial',
  'playful',
  'midnight',
];
