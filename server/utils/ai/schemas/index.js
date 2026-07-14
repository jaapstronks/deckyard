/**
 * AI Schema Validation Module
 *
 * Re-exports all Zod schemas for AI response validation.
 *
 * Usage:
 * ```js
 * import { validateSlideContent, validateOutlineResponse } from './schemas/index.js';
 *
 * // Validate Phase 2 slide content
 * const { valid, issues } = validateSlideContent('list-slide', content);
 *
 * // Validate Phase 1 outline response
 * const { valid, issues, data } = validateOutlineResponse(response);
 * ```
 */

// Phase 2: Refined slide content schemas
export {
  validateSlideContent,
  safeParseSlideContent,
  SLIDE_SCHEMAS,
  titleSlideSchema,
  chapterTitleSlideSchema,
  quoteSlideSchema,
  payoffSlideSchema,
  contentSlideSchema,
  lijstjeSlideSchema,
  timelineSlideSchema,
  kpiMetricsSlideSchema,
  iconCardGridSlideSchema,
  cardStackSlideSchema,
  textBlocksSlideSchema,
  contentColumnsSlideSchema,
  tableSlideSchema,
  chartSlideSchema,
} from './refined-slide.js';

// Phase 1: Outline response schemas
export {
  validateOutlineResponse,
  validateOutlineSlide,
  outlineSlideSchema,
  outlineResponseSchema,
  KNOWN_HINTS,
  getUnknownHints,
} from './outline.js';
