/**
 * AI Module - deck generation and the editing verbs around it.
 *
 * Exports:
 * - generateDeck / generateSlides / assembleDeck: the one generation
 *   pipeline (outline → revise → refine → validate → assemble), B756
 * - SLIDE_TYPE_CATALOG: For reference
 */

export { generateDeck, generateSlides, assembleDeck } from './generate-deck.js';

export { generateSessionId, createSessionLogger } from './logging.js';

export {
  SLIDE_TYPE_CATALOG,
  buildPhase2CatalogPrompt,
  getPhase1SlideTypes,
  getPhase2SlideTypes,
} from './slide-type-catalog.js';

export { logLlmConversation, logDeckGenerationSession } from './logging.js';

export {
  validateAndFixRefinedSlides,
  isSlideTypeValid,
  validateSlideCount,
  getRecentValidationLogs,
  getUnknownFields,
} from './validate-slides/index.js';

export { analyzeForCompression, applyCompression } from './compress-deck.js';

export {
  logValidationEvent,
  getValidationLogs,
  getValidationSummary,
  listLogFiles,
  downloadLogFile,
  cleanupOldLogs,
} from './validation-logging.js';

export {
  iteratePresentation,
  iterateSlide,
  iterateDeck,
  applyIterationPlan,
} from './iterate-deck.js';
