/**
 * Deck Generation V2 - Orchestrator
 *
 * Two-phase AI deck generation:
 * 1. Phase 1: Create outline (structure, chapters, rough content, grouping hints)
 * 2. Phase 2: Refine slides (select types, format content, add reasoning)
 *
 * This replaces the single-prompt approach in openai/deck.js
 */

import { generateOutline, separateSlidesForProcessing, groupSlidesForPhase2 } from './generate-outline.js';
import { refineAllSlideGroups } from './refine-slides.js';
import { reviseOutline } from './revise-outline.js';
import { createSessionLogger, generateSessionId } from './logging.js';
import { validateAndFixRefinedSlides } from './validate-slides.js';
import { cryptoUuid } from '../../../shared/slide-types/helpers.js';

/**
 * Assemble the final deck from refined slides
 *
 * @param {Object} outline - The outline from phase 1
 * @param {Array} refinedSlides - The refined slides from phase 2
 * @param {Object} options
 * @param {string} options.theme - Theme ID
 * @param {string} options.titleSlideType - Title slide type (e.g. 'title-slide')
 */
export function assembleDeck(outline, refinedSlides, { theme = 'default', titleSlideType = 'title-slide' } = {}) {
  const deck = {
    format: 'slidecreator.deck',
    version: 1,
    title: outline.title,
    theme,
    slides: [],
  };

  // Add automatic title slide first using the theme-appropriate type
  deck.slides.push({
    id: cryptoUuid(),
    type: titleSlideType,
    content: {
      title: outline.title || 'Presentation',
      subheading: outline.subtitle || '',
      background: 'lime',
    },
    notes: '',
    _aiReasoning: 'Automatic title slide',
  });

  // Build slides array from refined slides
  for (const refined of refinedSlides) {
    const slide = {
      id: cryptoUuid(),
      type: refined.type,
      content: refined.content,
      notes: refined.presenterNotes || '',
    };

    // Store AI metadata (can be removed in production)
    if (refined.reasoning) {
      slide._aiReasoning = refined.reasoning;
    }
    if (refined.alternativeType) {
      slide._aiAlternatives = [
        { type: refined.alternativeType, reason: refined.alternativeReason || '' },
      ];
    }
    if (refined._aiWarnings?.length) {
      slide._aiWarnings = refined._aiWarnings;
    }

    deck.slides.push(slide);
  }

  return deck;
}

/**
 * Generate a slide deck from raw content using two-phase AI approach
 *
 * @param {string} rawContent - Source text to create presentation from
 * @param {Object} options
 * @param {string} options.userName - Speaker name for title slide
 * @param {string} options.targetLang - 'nl' or 'en-GB'
 * @param {string} options.vendor - LLM vendor override
 * @param {string} options.theme - Deck theme
 * @param {string} options.titleSlideType - Title slide type for the theme (default: 'title-slide')
 * @param {boolean} options.enableLogging - Enable detailed logging (default: true)
 * @returns {Promise<Object>} Generated deck in deck JSON format
 */
export async function generateDeckV2(rawContent, {
  userName = '',
  targetLang = null,
  vendor = null,
  theme = 'default',
  titleSlideType = 'title-slide',
  enableLogging = true,
  reviseOutlineBeforeRefine = true,
  disabledSlideTypes = [],
  customSlideTypes = [],
  themeContext = null,
} = {}) {
  const startTime = Date.now();
  const sessionId = generateSessionId();
  const logger = enableLogging ? createSessionLogger(sessionId) : null;

  console.log(`[DeckGen V2] Starting session ${sessionId}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Generate Outline
  // ═══════════════════════════════════════════════════════════════════════════

  console.log('[DeckGen V2] Phase 1: Generating outline...');

  let outline = await generateOutline(rawContent, {
    userName,
    targetLang,
    vendor,
    onLog: logger ? (data) => logger.logPhase1(data) : null,
  });

  console.log(`[DeckGen V2] Phase 1 complete: ${outline.slides.length} slides, title: "${outline.title}"`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1b: Revise the outline
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Planning a deck is hard to get right in one pass, but an outline is small
  // and structured, so reviewing it is cheap relative to the quality it buys.
  // Failure here is non-fatal: the draft outline is used as-is.

  let outlineRevision = null;
  if (reviseOutlineBeforeRefine) {
    console.log('[DeckGen V2] Phase 1b: Revising outline...');
    const revised = await reviseOutline(outline, rawContent, {
      vendor,
      lang: outline.metadata?.requestedLang || outline.metadata?.detectedLang || 'en',
      onLog: logger ? (data) => logger.logPhase1(data) : null,
    });
    outline = revised.outline;
    outlineRevision = revised.revision;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEPARATE STRUCTURAL VS CONTENT SLIDES
  // ═══════════════════════════════════════════════════════════════════════════

  const { structuralSlides, contentGroups } = separateSlidesForProcessing(outline.slides);
  console.log(`[DeckGen V2] Structural slides: ${structuralSlides.length}, Content groups: ${contentGroups.length}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Refine Content Slides Only
  // ═══════════════════════════════════════════════════════════════════════════

  const lang = outline.metadata.requestedLang || outline.metadata.detectedLang || 'en';
  let refinedContentSlides = [];

  if (contentGroups.length > 0) {
    console.log('[DeckGen V2] Phase 2: Refining content slides...');

    refinedContentSlides = await refineAllSlideGroups(contentGroups, {
      lang,
      vendor,
      onLog: logger ? (data) => logger.logPhase2Call(data) : null,
      batchSize: 6,
      presentationContext: {
        title: outline.title,
        summary: outline.summary,
      },
      disabledSlideTypes,
      customSlideTypes,
      themeContext,
    });

    console.log(`[DeckGen V2] Phase 2 complete: ${refinedContentSlides.length} content slides refined`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMBINE AND VALIDATE ALL SLIDES
  // ═══════════════════════════════════════════════════════════════════════════

  // Merge structural + refined content slides, sorted by original index
  const allSlides = [...structuralSlides, ...refinedContentSlides]
    .sort((a, b) => a.originalIndex - b.originalIndex);

  const validatedSlides = validateAndFixRefinedSlides(allSlides);
  console.log(`[DeckGen V2] Validation complete: ${validatedSlides.length} slides total`);

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSEMBLE FINAL DECK
  // ═══════════════════════════════════════════════════════════════════════════

  const deck = assembleDeck(outline, validatedSlides, { theme, titleSlideType });

  // Add generation metadata
  deck._generationMeta = {
    sessionId,
    version: 'v2',
    phases: {
      phase1: {
        slideCount: outline.slides.length,
        chapterCount: outline.chapters.length,
        structuralSlides: structuralSlides.length,
        durationMs: outline.metadata.durationMs,
      },
      phase1b: outlineRevision
        ? {
            proposed: outlineRevision.proposed,
            applied: outlineRevision.applied.length,
            rejected: outlineRevision.rejected.length,
            durationMs: outlineRevision.durationMs,
          }
        : null,
      phase2: {
        groupCount: contentGroups.length,
        slideCount: refinedContentSlides.length,
      },
    },
    totalDurationMs: Date.now() - startTime,
    slideTypeDistribution: countSlideTypes(deck.slides),
    statusMessages: outline.statusMessages || [],
  };

  // Finalize logging
  if (logger) {
    logger.finalize(deck, {
      totalDurationMs: Date.now() - startTime,
    });
  }

  console.log(`[DeckGen V2] Session ${sessionId} complete in ${Date.now() - startTime}ms`);
  console.log(`[DeckGen V2] Slide types: ${JSON.stringify(deck._generationMeta.slideTypeDistribution)}`);

  return deck;
}

/**
 * Count slide types in deck
 */
function countSlideTypes(slides) {
  const counts = {};
  for (const slide of slides) {
    const type = slide?.type || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

/**
 * Generate outline only (for preview/debugging)
 */
export async function generateOutlineOnly(rawContent, options = {}) {
  return generateOutline(rawContent, options);
}

/**
 * Re-export utilities for testing
 */
export { groupSlidesForPhase2 } from './generate-outline.js';
export { refineSlideGroup } from './refine-slides.js';
export { generateSessionId, createSessionLogger } from './logging.js';