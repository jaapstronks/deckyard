// GENERATED FILE — do not edit by hand.
// Run `node scripts/generate-slide-inline-edit-aggregator.js` to regenerate.
// Source of truth: the `inline-edit.js` in each shared/slide-types/types/<name>/.

import * as chapterTitleSlide from './types/chapter-title-slide/inline-edit.js';
import * as chartSlide from './types/chart-slide/inline-edit.js';
import * as comparisonSlide from './types/comparison-slide/inline-edit.js';
import * as contentSlide from './types/content-slide/inline-edit.js';
import * as countdownSlide from './types/countdown-slide/inline-edit.js';
import * as customHtmlSlide from './types/custom-html-slide/inline-edit.js';
import * as cycleSlide from './types/cycle-slide/inline-edit.js';
import * as embedSlide from './types/embed-slide/inline-edit.js';
import * as endSlide from './types/end-slide/inline-edit.js';
import * as feedbackSlide from './types/feedback-slide/inline-edit.js';
import * as followInviteSlide from './types/follow-invite-slide/inline-edit.js';
import * as funnelSlide from './types/funnel-slide/inline-edit.js';
import * as gallerySlide from './types/gallery-slide/inline-edit.js';
import * as iconCardGridSlide from './types/icon-card-grid-slide/inline-edit.js';
import * as imageSlide from './types/image-slide/inline-edit.js';
import * as imageTextSlide from './types/image-text-slide/inline-edit.js';
import * as kpiMetricsSlide from './types/kpi-metrics-slide/inline-edit.js';
import * as leadCaptureSlide from './types/lead-capture-slide/inline-edit.js';
import * as likertSlide from './types/likert-slide/inline-edit.js';
import * as likertSliderSlide from './types/likert-slider-slide/inline-edit.js';
import * as listSlide from './types/list-slide/inline-edit.js';
import * as logoWallSlide from './types/logo-wall-slide/inline-edit.js';
import * as matrixSlide from './types/matrix-slide/inline-edit.js';
import * as payoffSlide from './types/payoff-slide/inline-edit.js';
import * as pollSlide from './types/poll-slide/inline-edit.js';
import * as processSlide from './types/process-slide/inline-edit.js';
import * as pyramidSlide from './types/pyramid-slide/inline-edit.js';
import * as quoteSlide from './types/quote-slide/inline-edit.js';
import * as tableSlide from './types/table-slide/inline-edit.js';
import * as teamCardsSlide from './types/team-cards-slide/inline-edit.js';
import * as textBlocksSlide from './types/text-blocks-slide/inline-edit.js';
import * as timelineSlide from './types/timeline-slide/inline-edit.js';
import * as titleSlide from './types/title-slide/inline-edit.js';
import * as videoSlide from './types/video-slide/inline-edit.js';

/**
 * Type name → the whole `inline-edit.js` module, so the maps below can be
 * sliced out of it per facet. A type declares whichever of the named exports it
 * has something to say about, and falls out of the maps for the rest — being
 * absent is a legitimate answer everywhere here.
 *
 * @type {Readonly<Record<string, Record<string, unknown>>>}
 */
const MODULES = Object.freeze({
  'chapter-title-slide': chapterTitleSlide,
  'chart-slide': chartSlide,
  'comparison-slide': comparisonSlide,
  'content-slide': contentSlide,
  'countdown-slide': countdownSlide,
  'custom-html-slide': customHtmlSlide,
  'cycle-slide': cycleSlide,
  'embed-slide': embedSlide,
  'end-slide': endSlide,
  'feedback-slide': feedbackSlide,
  'follow-invite-slide': followInviteSlide,
  'funnel-slide': funnelSlide,
  'gallery-slide': gallerySlide,
  'icon-card-grid-slide': iconCardGridSlide,
  'image-slide': imageSlide,
  'image-text-slide': imageTextSlide,
  'kpi-metrics-slide': kpiMetricsSlide,
  'lead-capture-slide': leadCaptureSlide,
  'likert-slide': likertSlide,
  'likert-slider-slide': likertSliderSlide,
  'list-slide': listSlide,
  'logo-wall-slide': logoWallSlide,
  'matrix-slide': matrixSlide,
  'payoff-slide': payoffSlide,
  'poll-slide': pollSlide,
  'process-slide': processSlide,
  'pyramid-slide': pyramidSlide,
  'quote-slide': quoteSlide,
  'table-slide': tableSlide,
  'team-cards-slide': teamCardsSlide,
  'text-blocks-slide': textBlocksSlide,
  'timeline-slide': timelineSlide,
  'title-slide': titleSlide,
  'video-slide': videoSlide,
});

/**
 * One named export across every type, with the types that do not declare it
 * dropped rather than mapped to `undefined`. Consumers ask "does this type
 * have one", and `in`/`Object.keys` should answer that honestly.
 *
 * @param {string} exportName
 * @returns {Readonly<Record<string, unknown>>}
 */
function facet(exportName) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(MODULES)
        .filter(([, mod]) => mod[exportName] !== undefined)
        .map(([type, mod]) => [type, mod[exportName]])
    )
  );
}

/**
 * Inline-edit descriptor per slide type: what the editor lets someone change on
 * the canvas, owned by the type rather than restated in one hand-kept map.
 *
 * A type without an entry has no inline editing yet (or a fork type declares
 * `inline: {}` on its definition instead) — consumers must treat a miss as
 * "side-form only", never as an error. See docs/reference/slide-type-directory.md.
 *
 * **Editor-side only.** Never import this from `registry.js` or a type's
 * `index.js`/`render.js`: the presenter renders slides without ever offering
 * one, and this is editor payload it must not pay for.
 *
 * @type {Readonly<Record<string, Object>>}
 */
export const SLIDE_TYPE_INLINE_EDIT = facet('inlineEdit');

/**
 * Inspector keep-list per slide type: the field keys the settings pane keeps
 * rendering once the canvas covers the rest of the slide.
 *
 * Sparse by design, and a *narrowing* rather than a listing — a type without an
 * entry gets the safe default (every field the inline layer does not cover), so
 * only a stale entry is a problem. Resolve it through
 * `slideTypeInspectorKeeps()` in ./inline-edit-companions.js rather than
 * reading this map: a fork type declares its own on the definition, and this
 * map is core's answer, never the population.
 *
 * @type {Readonly<Record<string, string[]>>}
 */
export const SLIDE_TYPE_INSPECTOR_KEEPS = facet('inspectorKeeps');

/**
 * The inline-edit descriptor for a type, or null when it has none.
 * @param {string} type - registry type name
 * @returns {Object|null}
 */
export function inlineEditFor(type) {
  return SLIDE_TYPE_INLINE_EDIT[type] || null;
}
