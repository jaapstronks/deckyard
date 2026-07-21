/**
 * AI Slide Type Catalog
 *
 * This module provides slide type definitions, examples, and prompt builders
 * for AI-powered presentation generation.
 *
 * Module structure:
 * - definitions.js: Core slide type definitions and schemas
 * - examples.js: Content examples for each slide type
 * - builders.js: Functions for building AI prompts
 * - custom-loader.js: Loads AI metadata from custom slide types
 */

// Re-export definitions
export {
  SLIDE_TYPE_CATALOG,
  STRUCTURAL_SLIDES,
  CONTENT_SLIDES,
  PEOPLE_SLIDES,
  INTERACTIVE_SLIDES,
  MEDIA_SLIDES,
  mergeCustomAiCatalog,
  getCoreSlideCatalog,
} from './definitions.js';

// Re-export examples
export {
  SLIDE_TYPE_EXAMPLES,
  getSlideTypeExamples,
  getSlideTypeExample,
} from './examples.js';

// Re-export builders
export {
  getPhase1SlideTypes,
  getPhase2SlideTypes,
  buildSlideTypeDescription,
  buildPhase2CatalogPrompt,
} from './builders.js';

// Re-export custom loader functions
export {
  loadCustomAiCatalog,
  loadCustomAiExamples,
  clearCustomAiCatalogCache,
  getCustomAiCatalogForTheme,
} from './custom-loader.js';

// Re-export the core-type override loader (custom/ai/catalog.js)
export { loadCustomCatalogOverrides } from './custom-catalog-loader.js';

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

/**
 * Initialize the AI catalog with custom slide type definitions
 * Call this during server startup to load custom AI metadata
 */
export async function initializeAiCatalog() {
  try {
    const { combined, added, overrides } = await loadCombinedCustomCatalog();
    const customExamples = await loadCustomAiExamples();

    if (Object.keys(combined).length > 0) {
      mergeCustomAiCatalog(combined);
      const parts = [];
      if (Object.keys(added).length > 0) parts.push(`${Object.keys(added).length} custom slide type(s)`);
      if (Object.keys(overrides).length > 0) parts.push(`${Object.keys(overrides).length} core-type override(s)`);
      console.log(`[ai-catalog] Merged ${parts.join(' + ')} into AI catalog`);
    }

    if (Object.keys(customExamples).length > 0) {
      mergeCustomExamples(customExamples);
      console.log(
        `[ai-catalog] Merged ${Object.keys(customExamples).length} custom example set(s) into AI catalog`
      );
    }
  } catch (err) {
    console.error('[ai-catalog] Error initializing custom AI catalog:', err.message);
  }
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
} catch (err) {
  // Silently fail on load - will be logged if initializeAiCatalog() is called explicitly
}