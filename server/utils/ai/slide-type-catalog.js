/**
 * AI Slide Type Catalog
 *
 * This file re-exports from the modular slide-catalog directory for backward compatibility.
 * The actual implementations are now split across:
 * - slide-catalog/definitions.js: the core catalog, derived from each type's ai.js
 * - slide-catalog/examples.js: Content examples for each slide type
 * - slide-catalog/builders.js: Functions for building AI prompts
 *
 * Key principles:
 * - A specialized slide type is ALWAYS better than content-slide when it fits
 * - Variety matters: avoid repetitive slide types in sequence
 * - Each slide type has specific strengths and anti-patterns
 */

export {
  SLIDE_TYPE_CATALOG,
  SLIDE_TYPE_EXAMPLES,
  getSlideTypeExamples,
  getSlideTypeExample,
  getPhase1SlideTypes,
  getPhase2SlideTypes,
  buildSlideTypeDescription,
  buildPhase2CatalogPrompt,
  GLOBAL_SLIDE_OPTIONS,
  buildGlobalOptionsPromptSection,
} from './slide-catalog/index.js';