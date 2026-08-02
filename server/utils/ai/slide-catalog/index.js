/**
 * AI Slide Type Catalog
 *
 * This module provides slide type definitions, examples, and prompt builders
 * for AI-powered presentation generation.
 *
 * Module structure:
 * - definitions.js: the core catalog, derived from type-ai.js
 * - type-ai.js: generated import list over each type's own ai.js
 * - examples.js: prompt examples, derived from type-ai.js (each type's aiExamples)
 * - builders.js: Functions for building AI prompts
 * - custom-loader.js: Loads AI metadata from custom slide types
 * - agent-catalog.js: The registry→agent derivation behind MCP get_slide_types
 */

// Re-export definitions
export { SLIDE_TYPE_CATALOG } from './definitions.js';

// Re-export examples
export {
  SLIDE_TYPE_EXAMPLES,
  getSlideTypeExamples,
} from './examples.js';

// Re-export builders
export {
  getPhase1SlideTypes,
  getPhase2SlideTypes,
  buildSlideTypeDescription,
  buildPhase2CatalogPrompt,
} from './builders.js';

// Re-export global per-slide options (background image, logo, text colour)
export {
  GLOBAL_SLIDE_OPTIONS,
  buildGlobalOptionsPromptSection,
} from './global-options.js';

// Import for initialization
import { mergeCustomAiCatalog, getCoreSlideCatalog } from './definitions.js';
import { loadCustomAiCatalog, loadCustomAiExamples } from './custom-loader.js';
import { loadCustomCatalogOverrides } from './custom-catalog-loader.js';
import { mergeCustomExamples } from './examples.js';

/**
 * Build the combined custom-catalog delta: new types added via
 * `custom/slide-types/*.js` plus core-type copy overrides from
 * `custom/ai/catalog.js`. Overrides win on a key collision (they are the
 * explicit override mechanism), and are validated against the known type set
 * (core types + any freshly-added custom types) so a typo is dropped loudly.
 *
 * @returns {Promise<Record<string, Object>>}
 */
async function loadCombinedCustomCatalog() {
  const customCatalog = await loadCustomAiCatalog();
  const knownTypes = new Set([
    ...Object.keys(getCoreSlideCatalog()),
    ...Object.keys(customCatalog),
  ]);
  const overrides = await loadCustomCatalogOverrides({ knownTypes });
  return { combined: { ...customCatalog, ...overrides }, added: customCatalog, overrides };
}

// Auto-initialize on module load (server-side only)
// This ensures custom AI metadata is available as soon as the module is imported
try {
  const { combined } = await loadCombinedCustomCatalog();
  const customExamples = await loadCustomAiExamples();

  if (Object.keys(combined).length > 0) {
    mergeCustomAiCatalog(combined);
  }

  if (Object.keys(customExamples).length > 0) {
    mergeCustomExamples(customExamples);
  }
} catch {
  // Silently fail on load — the server can run without custom AI metadata.
}