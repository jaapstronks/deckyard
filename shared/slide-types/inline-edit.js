// GENERATED FILE — do not edit by hand.
// Run `node scripts/generate-slide-inline-edit-aggregator.js` to regenerate.
// Source of truth: the `inline-edit.js` in each shared/slide-types/types/<name>/.

import { inlineEdit as cardStackSlideInlineEdit } from './types/card-stack-slide/inline-edit.js';
import { inlineEdit as chapterTitleSlideInlineEdit } from './types/chapter-title-slide/inline-edit.js';
import { inlineEdit as chartSlideInlineEdit } from './types/chart-slide/inline-edit.js';
import { inlineEdit as comparisonSlideInlineEdit } from './types/comparison-slide/inline-edit.js';
import { inlineEdit as contentColumnsSlideInlineEdit } from './types/content-columns-slide/inline-edit.js';
import { inlineEdit as contentSlideInlineEdit } from './types/content-slide/inline-edit.js';
import { inlineEdit as countdownSlideInlineEdit } from './types/countdown-slide/inline-edit.js';
import { inlineEdit as cycleSlideInlineEdit } from './types/cycle-slide/inline-edit.js';
import { inlineEdit as embedSlideInlineEdit } from './types/embed-slide/inline-edit.js';
import { inlineEdit as endSlideInlineEdit } from './types/end-slide/inline-edit.js';
import { inlineEdit as feedbackSlideInlineEdit } from './types/feedback-slide/inline-edit.js';
import { inlineEdit as funnelSlideInlineEdit } from './types/funnel-slide/inline-edit.js';
import { inlineEdit as gallerySlideInlineEdit } from './types/gallery-slide/inline-edit.js';
import { inlineEdit as iconCardGridSlideInlineEdit } from './types/icon-card-grid-slide/inline-edit.js';
import { inlineEdit as imageSlideInlineEdit } from './types/image-slide/inline-edit.js';
import { inlineEdit as imageTextSlideInlineEdit } from './types/image-text-slide/inline-edit.js';
import { inlineEdit as kpiMetricsSlideInlineEdit } from './types/kpi-metrics-slide/inline-edit.js';
import { inlineEdit as leadCaptureSlideInlineEdit } from './types/lead-capture-slide/inline-edit.js';
import { inlineEdit as lijstjeSlideInlineEdit } from './types/lijstje-slide/inline-edit.js';
import { inlineEdit as likertSlideInlineEdit } from './types/likert-slide/inline-edit.js';
import { inlineEdit as likertSliderSlideInlineEdit } from './types/likert-slider-slide/inline-edit.js';
import { inlineEdit as listSlideInlineEdit } from './types/list-slide/inline-edit.js';
import { inlineEdit as logoWallSlideInlineEdit } from './types/logo-wall-slide/inline-edit.js';
import { inlineEdit as matrixSlideInlineEdit } from './types/matrix-slide/inline-edit.js';
import { inlineEdit as pollSlideInlineEdit } from './types/poll-slide/inline-edit.js';
import { inlineEdit as processSlideInlineEdit } from './types/process-slide/inline-edit.js';
import { inlineEdit as pyramidSlideInlineEdit } from './types/pyramid-slide/inline-edit.js';
import { inlineEdit as quoteSlideInlineEdit } from './types/quote-slide/inline-edit.js';
import { inlineEdit as splitPartnerTitleSlideInlineEdit } from './types/split-partner-title-slide/inline-edit.js';
import { inlineEdit as tableSlideInlineEdit } from './types/table-slide/inline-edit.js';
import { inlineEdit as teamCardsSlideInlineEdit } from './types/team-cards-slide/inline-edit.js';
import { inlineEdit as textBlocksSlideInlineEdit } from './types/text-blocks-slide/inline-edit.js';
import { inlineEdit as timelineSlideInlineEdit } from './types/timeline-slide/inline-edit.js';
import { inlineEdit as titleSlideInlineEdit } from './types/title-slide/inline-edit.js';
import { inlineEdit as videoSlideInlineEdit } from './types/video-slide/inline-edit.js';

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
 * @type {Record<string, Object>}
 */
export const SLIDE_TYPE_INLINE_EDIT = {
  'card-stack-slide': cardStackSlideInlineEdit,
  'chapter-title-slide': chapterTitleSlideInlineEdit,
  'chart-slide': chartSlideInlineEdit,
  'comparison-slide': comparisonSlideInlineEdit,
  'content-columns-slide': contentColumnsSlideInlineEdit,
  'content-slide': contentSlideInlineEdit,
  'countdown-slide': countdownSlideInlineEdit,
  'cycle-slide': cycleSlideInlineEdit,
  'embed-slide': embedSlideInlineEdit,
  'end-slide': endSlideInlineEdit,
  'feedback-slide': feedbackSlideInlineEdit,
  'funnel-slide': funnelSlideInlineEdit,
  'gallery-slide': gallerySlideInlineEdit,
  'icon-card-grid-slide': iconCardGridSlideInlineEdit,
  'image-slide': imageSlideInlineEdit,
  'image-text-slide': imageTextSlideInlineEdit,
  'kpi-metrics-slide': kpiMetricsSlideInlineEdit,
  'lead-capture-slide': leadCaptureSlideInlineEdit,
  'lijstje-slide': lijstjeSlideInlineEdit,
  'likert-slide': likertSlideInlineEdit,
  'likert-slider-slide': likertSliderSlideInlineEdit,
  'list-slide': listSlideInlineEdit,
  'logo-wall-slide': logoWallSlideInlineEdit,
  'matrix-slide': matrixSlideInlineEdit,
  'poll-slide': pollSlideInlineEdit,
  'process-slide': processSlideInlineEdit,
  'pyramid-slide': pyramidSlideInlineEdit,
  'quote-slide': quoteSlideInlineEdit,
  'split-partner-title-slide': splitPartnerTitleSlideInlineEdit,
  'table-slide': tableSlideInlineEdit,
  'team-cards-slide': teamCardsSlideInlineEdit,
  'text-blocks-slide': textBlocksSlideInlineEdit,
  'timeline-slide': timelineSlideInlineEdit,
  'title-slide': titleSlideInlineEdit,
  'video-slide': videoSlideInlineEdit,
};

/**
 * The inline-edit descriptor for a type, or null when it has none.
 * @param {string} type - registry type name
 * @returns {Object|null}
 */
export function inlineEditFor(type) {
  return SLIDE_TYPE_INLINE_EDIT[type] || null;
}
