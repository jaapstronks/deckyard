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

// Merge core and custom types (custom types take precedence)
const RAW_SLIDE_TYPES = {
  ...CORE_SLIDE_TYPES,
  ...customTypes,
};

export const SLIDE_TYPES = Object.fromEntries(
  Object.entries(RAW_SLIDE_TYPES).map(([type, def]) => [
    type,
    addUiI18nKeysToSlideType(type, withGlobalSlideFields(def)),
  ])
);

// Names of types that came from custom/slide-types/ (fork-specific). Tooling
// that produces tracked artifacts (e.g. i18n extraction) skips these so a
// locally-installed fork customization can't leak into upstream files.
export const CUSTOM_SLIDE_TYPE_NAMES = Object.keys(customTypes);

// Core themes included with the OSS version.
// Additional themes can be added via custom/themes/ directory.
// Note: Themes are discovered dynamically at runtime from /themes/*.json and /custom/themes/*.json
export const THEMES = [
  DEFAULT_THEME_ID,
  // Neutral, non-branded themes for demos/sandbox instances
  'sandbox-warm',
  'sandbox-sage',
  'sandbox-dark',
];
