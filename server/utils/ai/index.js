/**
 * AI Module - V2 Two-Phase Deck Generation
 *
 * This module provides improved AI deck generation using a two-phase approach:
 * - Phase 1: Create outline (structure, chapters, rough content)
 * - Phase 2: Refine slides (select types, format content)
 *
 * Exports:
 * - generateDeckV2: Main entry point for deck generation
 * - generateOutlineOnly: For preview/debugging
 * - SLIDE_TYPE_CATALOG: For reference
 */

export {
  generateDeckV2,
  generateOutlineOnly,
  groupSlidesForPhase2,
  refineSlideGroup,
  generateSessionId,
  createSessionLogger,
} from './generate-deck-v2.js';

export {
  separateSlidesForProcessing,
} from './generate-outline.js';

export {
  SLIDE_TYPE_CATALOG,
  buildPhase2CatalogPrompt,
  getPhase1SlideTypes,
  getPhase2SlideTypes,
} from './slide-type-catalog.js';

export {
  logLlmConversation,
  logDeckGenerationSession,
} from './logging.js';

export {
  validateAndFixRefinedSlides,
  isSlideTypeValid,
  validateSlideCount,
  getRecentValidationLogs,
  getUnknownFields,
} from './validate-slides.js';

export {
  analyzeForCompression,
  applyCompression,
} from './compress-deck.js';

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