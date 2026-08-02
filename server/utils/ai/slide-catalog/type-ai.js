// GENERATED FILE — do not edit by hand.
// Run `node scripts/generate-slide-ai-aggregator.js` to regenerate.
// Source of truth: the `ai.js` in each shared/slide-types/types/<name>/.

import { ai as chapterTitleSlideAi } from '../../../../shared/slide-types/types/chapter-title-slide/ai.js';
import { ai as chartSlideAi, aiExamples as chartSlideAiExamples } from '../../../../shared/slide-types/types/chart-slide/ai.js';
import { ai as comparisonSlideAi, aiExamples as comparisonSlideAiExamples } from '../../../../shared/slide-types/types/comparison-slide/ai.js';
import { ai as contentSlideAi, aiExamples as contentSlideAiExamples } from '../../../../shared/slide-types/types/content-slide/ai.js';
import { ai as countdownSlideAi } from '../../../../shared/slide-types/types/countdown-slide/ai.js';
import { ai as cycleSlideAi, aiExamples as cycleSlideAiExamples } from '../../../../shared/slide-types/types/cycle-slide/ai.js';
import { ai as embedSlideAi } from '../../../../shared/slide-types/types/embed-slide/ai.js';
import { ai as endSlideAi } from '../../../../shared/slide-types/types/end-slide/ai.js';
import { ai as feedbackSlideAi } from '../../../../shared/slide-types/types/feedback-slide/ai.js';
import { ai as funnelSlideAi, aiExamples as funnelSlideAiExamples } from '../../../../shared/slide-types/types/funnel-slide/ai.js';
import { ai as gallerySlideAi, aiExamples as gallerySlideAiExamples } from '../../../../shared/slide-types/types/gallery-slide/ai.js';
import { ai as iconCardGridSlideAi, aiExamples as iconCardGridSlideAiExamples } from '../../../../shared/slide-types/types/icon-card-grid-slide/ai.js';
import { ai as imageSlideAi } from '../../../../shared/slide-types/types/image-slide/ai.js';
import { ai as imageTextSlideAi, aiExamples as imageTextSlideAiExamples } from '../../../../shared/slide-types/types/image-text-slide/ai.js';
import { ai as kpiMetricsSlideAi, aiExamples as kpiMetricsSlideAiExamples } from '../../../../shared/slide-types/types/kpi-metrics-slide/ai.js';
import { ai as likertSlideAi } from '../../../../shared/slide-types/types/likert-slide/ai.js';
import { ai as likertSliderSlideAi } from '../../../../shared/slide-types/types/likert-slider-slide/ai.js';
import { ai as listSlideAi, aiExamples as listSlideAiExamples } from '../../../../shared/slide-types/types/list-slide/ai.js';
import { ai as logoWallSlideAi, aiExamples as logoWallSlideAiExamples } from '../../../../shared/slide-types/types/logo-wall-slide/ai.js';
import { ai as matrixSlideAi, aiExamples as matrixSlideAiExamples } from '../../../../shared/slide-types/types/matrix-slide/ai.js';
import { ai as payoffSlideAi } from '../../../../shared/slide-types/types/payoff-slide/ai.js';
import { ai as pollSlideAi } from '../../../../shared/slide-types/types/poll-slide/ai.js';
import { ai as processSlideAi, aiExamples as processSlideAiExamples } from '../../../../shared/slide-types/types/process-slide/ai.js';
import { ai as pyramidSlideAi, aiExamples as pyramidSlideAiExamples } from '../../../../shared/slide-types/types/pyramid-slide/ai.js';
import { ai as quoteSlideAi, aiExamples as quoteSlideAiExamples } from '../../../../shared/slide-types/types/quote-slide/ai.js';
import { ai as tableSlideAi, aiExamples as tableSlideAiExamples } from '../../../../shared/slide-types/types/table-slide/ai.js';
import { ai as teamCardsSlideAi, aiExamples as teamCardsSlideAiExamples } from '../../../../shared/slide-types/types/team-cards-slide/ai.js';
import { ai as textBlocksSlideAi, aiExamples as textBlocksSlideAiExamples } from '../../../../shared/slide-types/types/text-blocks-slide/ai.js';
import { ai as timelineSlideAi, aiExamples as timelineSlideAiExamples } from '../../../../shared/slide-types/types/timeline-slide/ai.js';
import { ai as titleSlideAi } from '../../../../shared/slide-types/types/title-slide/ai.js';
import { ai as videoSlideAi } from '../../../../shared/slide-types/types/video-slide/ai.js';

/**
 * The agent-facing editorial copy per slide type — description, bestFor,
 * notFor, and the per-type extras a few types add (`allowedIcons`,
 * `varietyRule`) — owned by the type rather than filed into a category module.
 *
 * A type without an entry is withheld from agents, or has not been written up
 * yet; `agent-catalog.js` still derives a schema for it and flags it
 * `documented: false`, so a miss degrades rather than disappears.
 *
 * **Server-side only.** This is ~168 KB of prose the browser never executes.
 * Never import it, or any type's `ai.js`, from `shared/` or `client/` —
 * tests/slide-type-directory-boundary.test.js walks the real module graph from
 * the render entry and fails on any route into one.
 *
 * @type {Readonly<Record<string, Object>>}
 */
export const SLIDE_TYPE_AI = Object.freeze({
  'chapter-title-slide': chapterTitleSlideAi,
  'chart-slide': chartSlideAi,
  'comparison-slide': comparisonSlideAi,
  'content-slide': contentSlideAi,
  'countdown-slide': countdownSlideAi,
  'cycle-slide': cycleSlideAi,
  'embed-slide': embedSlideAi,
  'end-slide': endSlideAi,
  'feedback-slide': feedbackSlideAi,
  'funnel-slide': funnelSlideAi,
  'gallery-slide': gallerySlideAi,
  'icon-card-grid-slide': iconCardGridSlideAi,
  'image-slide': imageSlideAi,
  'image-text-slide': imageTextSlideAi,
  'kpi-metrics-slide': kpiMetricsSlideAi,
  'likert-slide': likertSlideAi,
  'likert-slider-slide': likertSliderSlideAi,
  'list-slide': listSlideAi,
  'logo-wall-slide': logoWallSlideAi,
  'matrix-slide': matrixSlideAi,
  'payoff-slide': payoffSlideAi,
  'poll-slide': pollSlideAi,
  'process-slide': processSlideAi,
  'pyramid-slide': pyramidSlideAi,
  'quote-slide': quoteSlideAi,
  'table-slide': tableSlideAi,
  'team-cards-slide': teamCardsSlideAi,
  'text-blocks-slide': textBlocksSlideAi,
  'timeline-slide': timelineSlideAi,
  'title-slide': titleSlideAi,
  'video-slide': videoSlideAi,
});

/**
 * The editorial copy for a type, or null when it has none.
 * @param {string} type - registry type name
 * @returns {Object|null}
 */
export function aiFor(type) {
  return SLIDE_TYPE_AI[type] || null;
}

/**
 * The filled-in prompt examples per slide type — each type's `aiExamples`
 * export. **Sparse by design**: examples exist for the types whose shape is
 * hard to infer from a schema alone; a type without an entry shows the model
 * its schema without worked content, which is fine (the `ai-examples`
 * companion is optional in tests/helpers/slide-type-companions.js).
 * @type {Readonly<Record<string, Array<Object>>>}
 */
export const SLIDE_TYPE_AI_EXAMPLES = Object.freeze({
  'chart-slide': chartSlideAiExamples,
  'comparison-slide': comparisonSlideAiExamples,
  'content-slide': contentSlideAiExamples,
  'cycle-slide': cycleSlideAiExamples,
  'funnel-slide': funnelSlideAiExamples,
  'gallery-slide': gallerySlideAiExamples,
  'icon-card-grid-slide': iconCardGridSlideAiExamples,
  'image-text-slide': imageTextSlideAiExamples,
  'kpi-metrics-slide': kpiMetricsSlideAiExamples,
  'list-slide': listSlideAiExamples,
  'logo-wall-slide': logoWallSlideAiExamples,
  'matrix-slide': matrixSlideAiExamples,
  'process-slide': processSlideAiExamples,
  'pyramid-slide': pyramidSlideAiExamples,
  'quote-slide': quoteSlideAiExamples,
  'table-slide': tableSlideAiExamples,
  'team-cards-slide': teamCardsSlideAiExamples,
  'text-blocks-slide': textBlocksSlideAiExamples,
  'timeline-slide': timelineSlideAiExamples,
});
