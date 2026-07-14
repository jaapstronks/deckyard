/**
 * AI Slide Type Examples
 *
 * Content examples for each slide type, used to generate AI prompts.
 * Multiple variations are provided for complex slide types.
 *
 * REFACTORED: Examples are now organized by category in ./examples/ directory:
 * - basic-slides.js - Content, list, quote, image-text, agenda
 * - data-slides.js - Tables, charts, KPI metrics
 * - card-slides.js - Icon grids, card stacks, team cards, columns
 * - diagram-slides.js - Matrix, pyramid, funnel, cycle, process, timeline, comparison
 * - text-blocks-slide.js - Multi-row text block layouts
 *
 * This file re-exports everything for backward compatibility.
 */

export {
  SLIDE_TYPE_EXAMPLES,
  getSlideTypeExamples,
  getSlideTypeExample,
  mergeCustomExamples,
  // Category-specific exports
  BASIC_SLIDE_EXAMPLES,
  DATA_SLIDE_EXAMPLES,
  CARD_SLIDE_EXAMPLES,
  DIAGRAM_SLIDE_EXAMPLES,
  TEXT_BLOCKS_SLIDE_EXAMPLES,
} from './examples/index.js';