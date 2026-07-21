/**
 * Stage-separated access to the generation pipeline.
 *
 * `generateDeckV2` runs phase 1 and phase 2 as one call, which means testing a
 * phase 1 prompt costs a full deck (one outline call plus one refinement call
 * per section, each carrying the ~32k-token slide-type catalog) and measures
 * the phase 1 change *through* phase 2's noise. Splitting the stages lets a
 * change be priced and attributed to the prompt it actually came from.
 *
 * These functions compose the app's own exported stage functions in the same
 * order `generateDeckV2` does — they do not reimplement it. `runFullPipeline`
 * exists so the equivalence can be asserted in a test; if this composition ever
 * drifts from the orchestrator, that test fails.
 */

import {
  generateOutline,
  separateSlidesForProcessing,
} from '../../server/utils/ai/generate-outline.js';
import { refineAllSlideGroups } from '../../server/utils/ai/refine-slides.js';
import { validateAndFixRefinedSlides } from '../../server/utils/ai/validate-slides.js';
import { assembleDeck } from '../../server/utils/ai/generate-deck-v2.js';
import { reviseOutline } from '../../server/utils/ai/revise-outline.js';

/**
 * Phase 1 only: source document -> outline.
 *
 * One LLM call. This is the stage that decides how the document is split into
 * sections and how many slides each gets, so it is the right thing to iterate
 * on when the *structure* is wrong rather than the slide copy.
 *
 * @param {string} sourceText
 * @param {Object} options
 * @param {string|null} [options.targetLang]
 * @param {string|null} [options.vendor]
 * @param {string} [options.userName]
 * @returns {Promise<object>} The outline, including its own metadata
 */
export async function runOutlineStage(
  sourceText,
  { targetLang = null, vendor = null, userName = '', revise = false } = {}
) {
  const outline = await generateOutline(sourceText, { userName, targetLang, vendor, onLog: null });
  if (!revise) return outline;

  const lang = outline.metadata?.requestedLang || outline.metadata?.detectedLang || 'en';
  const revised = await reviseOutline(outline, sourceText, { vendor, lang });
  // Carry the revision record so a run can report what the pass actually did.
  return { ...revised.outline, _revision: revised.revision };
}

/**
 * Split an outline into the structural slides (resolved directly, no LLM call)
 * and the content groups that phase 2 refines.
 *
 * @param {object} outline
 * @returns {{structuralSlides: object[], contentGroups: object[]}}
 */
export function splitOutline(outline) {
  return separateSlidesForProcessing(outline.slides);
}

/**
 * Phase 2 only: a frozen outline -> a finished deck.
 *
 * Because the outline is an input rather than something regenerated each time,
 * any score movement between two runs of this stage is attributable to the
 * phase 2 prompt alone.
 *
 * @param {object} outline - Outline from runOutlineStage (or a stored one)
 * @param {Object} options
 * @param {string|null} [options.vendor]
 * @param {number|null} [options.groupLimit] - Refine only the first N content
 *   groups. Use this to iterate on one section: it is one LLM call per group,
 *   so limiting to the first section makes a round cost cents.
 * @param {string} [options.theme]
 * @returns {Promise<{deck: object, groupCount: number, refinedCount: number}>}
 */
export async function runRefineStage(outline, { vendor = null, groupLimit = null, theme = 'default' } = {}) {
  const { structuralSlides, contentGroups } = splitOutline(outline);

  const groups =
    Number.isFinite(groupLimit) && groupLimit > 0
      ? contentGroups.slice(0, groupLimit)
      : contentGroups;

  const lang = outline.metadata?.requestedLang || outline.metadata?.detectedLang || 'en';

  let refinedContentSlides = [];
  if (groups.length > 0) {
    refinedContentSlides = await refineAllSlideGroups(groups, {
      lang,
      vendor,
      onLog: null,
      batchSize: 6,
      presentationContext: { title: outline.title, summary: outline.summary },
    });
  }

  const allSlides = selectSlidesForDeck({
    structuralSlides,
    refinedContentSlides,
    partial: groups.length !== contentGroups.length,
  });

  const deck = assembleDeck(outline, validateAndFixRefinedSlides(allSlides), { theme });

  return { deck, groupCount: contentGroups.length, refinedCount: refinedContentSlides.length };
}

/**
 * Both stages, composed exactly as the orchestrator composes them.
 *
 * @param {string} sourceText
 * @param {Object} options - Passed to both stages
 * @returns {Promise<{deck: object, outline: object}>}
 */
export async function runFullPipeline(sourceText, options = {}) {
  const outline = await runOutlineStage(sourceText, options);
  const { deck } = await runRefineStage(outline, options);
  return { deck, outline };
}

/**
 * Combine structural and refined slides into deck order.
 *
 * On a partial run (`--groups N`) only the leading sections were refined, so
 * structural slides beyond the refined span are dropped: the result should read
 * as a coherent opening stretch of the deck rather than one with holes where
 * the unrefined sections would have been.
 *
 * @param {Object} options
 * @param {object[]} options.structuralSlides
 * @param {object[]} options.refinedContentSlides
 * @param {boolean} options.partial - Whether only some groups were refined
 * @returns {object[]} Slides in original-index order
 */
export function selectSlidesForDeck({ structuralSlides, refinedContentSlides, partial }) {
  const highestIndex = refinedContentSlides.reduce(
    (max, slide) => Math.max(max, slide.originalIndex ?? 0),
    0
  );
  const kept = partial
    ? structuralSlides.filter((slide) => (slide.originalIndex ?? 0) <= highestIndex)
    : structuralSlides;

  return [...kept, ...refinedContentSlides].sort((a, b) => a.originalIndex - b.originalIndex);
}
