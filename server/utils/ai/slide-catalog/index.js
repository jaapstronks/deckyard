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

// Re-export global per-slide options (background image, logo, text colour)
export {
  GLOBAL_SLIDE_OPTIONS,
  buildGlobalOptionsPromptSection,
} from './global-options.js';

// Import for initialization
import { mergeCustomAiCatalog } from './definitions.js';
import { loadCustomAiCatalog, loadCustomAiExamples } from './custom-loader.js';
import { mergeCustomExamples } from './examples.js';

/**
 * Initialize the AI catalog with custom slide type definitions
 * Call this during server startup to load custom AI metadata
 */
export async function initializeAiCatalog() {
  try {
    const customCatalog = await loadCustomAiCatalog();
    const customExamples = await loadCustomAiExamples();

    if (Object.keys(customCatalog).length > 0) {
      mergeCustomAiCatalog(customCatalog);
      console.log(
        `[ai-catalog] Merged ${Object.keys(customCatalog).length} custom slide type(s) into AI catalog`
      );
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
  const customCatalog = await loadCustomAiCatalog();
  const customExamples = await loadCustomAiExamples();

  if (Object.keys(customCatalog).length > 0) {
    mergeCustomAiCatalog(customCatalog);
  }

  if (Object.keys(customExamples).length > 0) {
    mergeCustomExamples(customExamples);
  }
} catch (err) {
  // Silently fail on load - will be logged if initializeAiCatalog() is called explicitly
}