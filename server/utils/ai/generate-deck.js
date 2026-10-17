/**
 * Deck generation - the one pipeline every AI creation path runs.
 *
 * Outline (phase 1) → revise (phase 1b) → separate structural from content
 * slides → refine (phase 2) → validate → assemble. Two layers, so a source
 * that assembles its own deck (images to keep, a title slide from a file) can
 * stop after the slides: `generateSlides()` runs the model phases and
 * `assembleDeck()` is a pure function on its result. `generateDeck()` is the
 * two together, for the callers that take the deck as it comes.
 *
 * The service knows no source: a route or tool passes what its source has
 * (theme context, a target length, a cancel signal, progress hooks) and gets
 * the same chain the others get. `tests/ai-generation-single-path.test.js`
 * holds the rest of the server to that: only this module imports the outline,
 * refine and revise steps (B756).
 */

import {
  generateOutline,
  separateSlidesForProcessing,
} from './generate-outline.js';
import { refineAllSlideGroups } from './refine-slides.js';
import { reviseOutline as reviseOutlineStep } from './revise-outline.js';
import { createSessionLogger, generateSessionId } from './logging.js';
import { validateAndFixRefinedSlides } from './validate-slides/index.js';
import { cryptoUuid } from '../../../shared/slide-types/helpers.js';
import { DECK_FORMAT_ID } from '../../../shared/slide-types/deck-format-id.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../shared/i18n-utils.js';
import { createLogger } from '../logger.js';

const log = createLogger('generate-deck');

/**
 * The options every generation path shares. A path passes what its source
 * has; everything is optional except `slideTypes`.
 *
 * @typedef {object} GenerateOptions
 * @property {string} [userName] - Speaker name for the outline.
 * @property {string|null} [targetLang] - The language the caller asked for;
 *   absent or off-axis means "the source's language".
 * @property {string|null} [vendor] - LLM vendor override.
 * @property {string} [targetLength] - `auto`, `5min`, `10min`, `20min`, `30min`.
 * @property {string} [rawFirstSlideTitle] - The source file's own first title,
 *   as context for the outline.
 * @property {boolean} [reviseOutline] - Run phase 1b (default on).
 * @property {Record<string, Object>} slideTypes - The organization's merged
 *   type map; the refined slides are fixed against it (B247).
 * @property {string[]} [disabledSlideTypes]
 * @property {Object[]} [customSlideTypes]
 * @property {Object|null} [themeContext] - From `loadAiThemeContext()`.
 * @property {AbortSignal|null} [signal] - Reaches every model call; checked
 *   between the phases.
 * @property {number} [batchSize] - Parallel refine calls (default 6).
 * @property {(outline: Object, info: { sections: number }) => void} [onOutline]
 *   - Called once the (revised) outline is ready, before phase 2.
 * @property {(message: string) => void} [onStatusMessage]
 * @property {(progress: { done: number, total: number }) => void} [onGroupDone]
 * @property {ReturnType<typeof createSessionLogger>} [logger] - A session
 *   logger to write to; one is made when absent.
 */

/**
 * The deck language: the one the caller asked for, else the one the outline
 * detected, else the installation default (B756).
 *
 * @param {string|null|undefined} targetLang
 * @param {Object} outline
 * @returns {string}
 */
function resolveDeckLang(targetLang, outline) {
  return (
    normalizeLang(targetLang) ||
    normalizeLang(outline?.metadata?.detectedLang) ||
    DEFAULT_DECK_LANG
  );
}

/**
 * Run the model phases: outline, revise, refine, validate.
 *
 * Every slide comes back with what phase 2 produced (`originalIndex`,
 * `presenterNotes`, `reasoning`, `alternativeType`), structural slides
 * included, sorted on `originalIndex`.
 *
 * @param {string} rawContent - Source text to create a presentation from.
 * @param {GenerateOptions} options
 * @returns {Promise<{ outline: Object, slides: Object[], lang: string, meta: Object }>}
 */
export async function generateSlides(
  rawContent,
  {
    userName = '',
    targetLang = null,
    vendor = null,
    targetLength = 'auto',
    rawFirstSlideTitle = '',
    reviseOutline = true,
    slideTypes,
    disabledSlideTypes = [],
    customSlideTypes = [],
    themeContext = null,
    signal = null,
    batchSize = 6,
    onOutline = null,
    onStatusMessage = null,
    onGroupDone = null,
    logger = createSessionLogger(generateSessionId()),
  } = {},
) {
  const startTime = Date.now();

  // ── Phase 1: outline ────────────────────────────────────────────────────
  let outline = await generateOutline(rawContent, {
    userName,
    targetLang,
    vendor,
    targetLength,
    rawFirstSlideTitle,
    onLog: (data) => logger.logPhase1(data),
    signal,
  });
  log.info(
    `Phase 1 complete: ${outline.slides.length} slides, title: "${outline.title}"`,
  );

  const lang = resolveDeckLang(targetLang, outline);

  // ── Phase 1b: revise the outline ────────────────────────────────────────
  // Planning a deck is hard to get right in one pass, but an outline is small
  // and structured, so reviewing it is cheap relative to the quality it buys.
  // Failure here is non-fatal: the draft outline is used as-is.
  let outlineRevision = null;
  if (reviseOutline) {
    const revised = await reviseOutlineStep(outline, rawContent, {
      vendor,
      lang,
      onLog: (data) => logger.logPhase1(data),
      signal,
    });
    outline = revised.outline;
    outlineRevision = revised.revision;
  }
  signal?.throwIfAborted();

  // ── Structural vs content slides ────────────────────────────────────────
  const { structuralSlides, contentGroups } = separateSlidesForProcessing(
    outline.slides,
  );
  if (typeof onOutline === 'function') {
    onOutline(outline, { sections: contentGroups.length });
  }

  // ── Phase 2: refine the content slides ──────────────────────────────────
  let refinedContentSlides = [];
  if (contentGroups.length > 0) {
    refinedContentSlides = await refineAllSlideGroups(contentGroups, {
      lang,
      vendor,
      onLog: (data) => logger.logPhase2Call(data),
      batchSize,
      presentationContext: {
        title: outline.title,
        summary: outline.summary,
      },
      onStatusMessage,
      onGroupDone,
      disabledSlideTypes,
      customSlideTypes,
      themeContext,
      signal,
      slideTypes,
    });
    log.info(
      `Phase 2 complete: ${refinedContentSlides.length} content slides refined`,
    );
  }

  // ── Combine and validate ────────────────────────────────────────────────
  const allSlides = [...structuralSlides, ...refinedContentSlides].sort(
    (a, b) => a.originalIndex - b.originalIndex,
  );
  const slides = validateAndFixRefinedSlides(allSlides, { slideTypes });

  const meta = {
    sessionId: logger.sessionId,
    lang,
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
    durationMs: Date.now() - startTime,
    statusMessages: outline.statusMessages || [],
  };

  return { outline, slides, lang, meta };
}

/**
 * Assemble a deck from the outline and the generated slides. Pure.
 *
 * @param {Object} outline - The outline from phase 1.
 * @param {Array} refinedSlides - The slides `generateSlides()` returned.
 * @param {Object} [options]
 * @param {string} [options.theme] - Theme id.
 * @param {string} [options.titleSlideType] - The theme's title slide type.
 * @param {string} [options.lang] - The deck language; lands in `deck.lang`.
 * @param {Object|null} [options.titleSlide] - `null` leaves the automatic
 *   title slide out; an object is merged over its content (a background
 *   image, say).
 * @returns {Object} Deck JSON.
 */
export function assembleDeck(
  outline,
  refinedSlides,
  {
    theme = 'default',
    titleSlideType = 'title-slide',
    lang,
    titleSlide = {},
  } = {},
) {
  const deck = {
    format: DECK_FORMAT_ID,
    version: 1,
    title: outline.title,
    theme,
    ...(lang ? { lang } : {}),
    slides: [],
  };

  if (titleSlide !== null) {
    deck.slides.push({
      id: cryptoUuid(),
      type: titleSlideType,
      content: {
        title: outline.title || 'Presentation',
        subheading: outline.subtitle || '',
        background: 'lime',
        ...titleSlide,
      },
      notes: '',
      _aiReasoning: 'Automatic title slide',
    });
  }

  for (const refined of refinedSlides) {
    const slide = {
      id: cryptoUuid(),
      type: refined.type,
      content: refined.content,
      notes: refined.presenterNotes || '',
    };
    if (refined.reasoning) {
      slide._aiReasoning = refined.reasoning;
    }
    if (refined.alternativeType) {
      slide._aiAlternatives = [
        {
          type: refined.alternativeType,
          reason: refined.alternativeReason || '',
        },
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
 * Generate a deck from raw content: `generateSlides()` then `assembleDeck()`.
 *
 * The deck carries `lang` (the one language rule, {@link resolveDeckLang})
 * and `_generationMeta`; the session log is finalized here, also for a run
 * that failed (not for one the caller cancelled).
 *
 * @param {string} rawContent - Source text to create a presentation from.
 * @param {GenerateOptions & { theme?: string, titleSlideType?: string }} options
 * @returns {Promise<Object>} Deck JSON.
 */
export async function generateDeck(
  rawContent,
  { theme = 'default', titleSlideType = 'title-slide', ...options } = {},
) {
  const startTime = Date.now();
  const logger = options.logger || createSessionLogger(generateSessionId());
  log.info(`Starting session ${logger.sessionId}`);

  let generated;
  try {
    generated = await generateSlides(rawContent, { ...options, logger });
  } catch (err) {
    if (!options.signal?.aborted) {
      try {
        logger.finalize({ error: err?.message }, { failed: true });
      } catch (logErr) {
        // A log that fails to write never masks the generation error.
        log.warn(`Session ${logger.sessionId}: failed log not written`, {
          message: logErr?.message,
        });
      }
    }
    throw err;
  }

  const { outline, slides, lang, meta } = generated;
  const deck = assembleDeck(outline, slides, { theme, titleSlideType, lang });
  deck._generationMeta = {
    ...meta,
    totalDurationMs: Date.now() - startTime,
    slideTypeDistribution: countSlideTypes(deck.slides),
  };

  logger.finalize(deck, { totalDurationMs: Date.now() - startTime });
  log.info(
    `Session ${logger.sessionId} complete in ${Date.now() - startTime}ms`,
  );

  return deck;
}

/** Count slide types in a deck. */
function countSlideTypes(slides) {
  const counts = {};
  for (const slide of slides) {
    const type = slide?.type || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}
