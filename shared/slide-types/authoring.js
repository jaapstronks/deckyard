// GENERATED FILE — do not edit by hand.
// Run `node scripts/generate-slide-authoring-aggregator.js` to regenerate.
// Source of truth: the `authoring.js` in each shared/slide-types/types/<name>/.

import chapterTitleSlideAuthoring from './types/chapter-title-slide/authoring.js';
import chartSlideAuthoring from './types/chart-slide/authoring.js';
import comparisonSlideAuthoring from './types/comparison-slide/authoring.js';
import contentSlideAuthoring from './types/content-slide/authoring.js';
import countdownSlideAuthoring from './types/countdown-slide/authoring.js';
import customHtmlSlideAuthoring from './types/custom-html-slide/authoring.js';
import cycleSlideAuthoring from './types/cycle-slide/authoring.js';
import embedSlideAuthoring from './types/embed-slide/authoring.js';
import endSlideAuthoring from './types/end-slide/authoring.js';
import feedbackSlideAuthoring from './types/feedback-slide/authoring.js';
import followInviteSlideAuthoring from './types/follow-invite-slide/authoring.js';
import funnelSlideAuthoring from './types/funnel-slide/authoring.js';
import gallerySlideAuthoring from './types/gallery-slide/authoring.js';
import iconCardGridSlideAuthoring from './types/icon-card-grid-slide/authoring.js';
import imageSlideAuthoring from './types/image-slide/authoring.js';
import imageTextSlideAuthoring from './types/image-text-slide/authoring.js';
import kpiMetricsSlideAuthoring from './types/kpi-metrics-slide/authoring.js';
import likertSlideAuthoring from './types/likert-slide/authoring.js';
import likertSliderSlideAuthoring from './types/likert-slider-slide/authoring.js';
import listSlideAuthoring from './types/list-slide/authoring.js';
import logoWallSlideAuthoring from './types/logo-wall-slide/authoring.js';
import matrixSlideAuthoring from './types/matrix-slide/authoring.js';
import payoffSlideAuthoring from './types/payoff-slide/authoring.js';
import pollSlideAuthoring from './types/poll-slide/authoring.js';
import processSlideAuthoring from './types/process-slide/authoring.js';
import pyramidSlideAuthoring from './types/pyramid-slide/authoring.js';
import quoteSlideAuthoring from './types/quote-slide/authoring.js';
import tableSlideAuthoring from './types/table-slide/authoring.js';
import teamCardsSlideAuthoring from './types/team-cards-slide/authoring.js';
import textBlocksSlideAuthoring from './types/text-blocks-slide/authoring.js';
import timelineSlideAuthoring from './types/timeline-slide/authoring.js';
import titleSlideAuthoring from './types/title-slide/authoring.js';
import videoSlideAuthoring from './types/video-slide/authoring.js';

/**
 * Author-facing companions per slide type: the picker's glyph, copy and sample
 * content, owned by the type rather than restated in each editor surface.
 *
 * A type without an entry has not moved its companions into the directory form
 * yet (or has none to move) — consumers must treat a miss as "fall back", never
 * as an error. See docs/reference/slide-type-directory.md.
 *
 * **Editor-side only.** Never import this from `registry.js` or a type's
 * `index.js`/`render.js`: the presenter renders slides without ever offering
 * one, and this is picker payload it must not pay for.
 *
 * @type {Record<string, Object>}
 */
export const SLIDE_TYPE_AUTHORING = {
  'chapter-title-slide': chapterTitleSlideAuthoring,
  'chart-slide': chartSlideAuthoring,
  'comparison-slide': comparisonSlideAuthoring,
  'content-slide': contentSlideAuthoring,
  'countdown-slide': countdownSlideAuthoring,
  'custom-html-slide': customHtmlSlideAuthoring,
  'cycle-slide': cycleSlideAuthoring,
  'embed-slide': embedSlideAuthoring,
  'end-slide': endSlideAuthoring,
  'feedback-slide': feedbackSlideAuthoring,
  'follow-invite-slide': followInviteSlideAuthoring,
  'funnel-slide': funnelSlideAuthoring,
  'gallery-slide': gallerySlideAuthoring,
  'icon-card-grid-slide': iconCardGridSlideAuthoring,
  'image-slide': imageSlideAuthoring,
  'image-text-slide': imageTextSlideAuthoring,
  'kpi-metrics-slide': kpiMetricsSlideAuthoring,
  'likert-slide': likertSlideAuthoring,
  'likert-slider-slide': likertSliderSlideAuthoring,
  'list-slide': listSlideAuthoring,
  'logo-wall-slide': logoWallSlideAuthoring,
  'matrix-slide': matrixSlideAuthoring,
  'payoff-slide': payoffSlideAuthoring,
  'poll-slide': pollSlideAuthoring,
  'process-slide': processSlideAuthoring,
  'pyramid-slide': pyramidSlideAuthoring,
  'quote-slide': quoteSlideAuthoring,
  'table-slide': tableSlideAuthoring,
  'team-cards-slide': teamCardsSlideAuthoring,
  'text-blocks-slide': textBlocksSlideAuthoring,
  'timeline-slide': timelineSlideAuthoring,
  'title-slide': titleSlideAuthoring,
  'video-slide': videoSlideAuthoring,
};

/**
 * The authoring companion for a type, or null when it has none.
 * @param {string} type - registry type name
 * @returns {Object|null}
 */
export function authoringFor(type) {
  return SLIDE_TYPE_AUTHORING[type] || null;
}
