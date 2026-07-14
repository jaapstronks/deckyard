/**
 * Custom AI Slide Catalog Loader
 *
 * Loads AI metadata from custom slide type definitions in /custom/slide-types/.
 * This allows custom slide types to be recognized by the AI wizard.
 *
 * Custom slide types can include an `ai` property with:
 * - category: 'structural' | 'content' | 'interactive' | 'media' | 'people'
 * - resolveInPhase1: boolean (true for structural slides resolved in outline phase)
 * - description: Multi-line description for the AI
 * - bestFor: Array of use cases when this slide type is ideal
 * - notFor: Array of anti-patterns when NOT to use this slide type
 * - schema: Object defining content field constraints for the AI
 * - examples: Array of example content objects (optional)
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the repo root (four levels up from server/utils/ai/slide-catalog/)
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const CUSTOM_SLIDE_TYPES_DIR = join(REPO_ROOT, 'custom', 'slide-types');

// Cache for loaded custom AI definitions
let customAiCatalogCache = null;
let customAiExamplesCache = null;

/**
 * Load AI metadata from all custom slide type definitions
 * @returns {Promise<Object>} Map of type-name -> AI definition
 */
export async function loadCustomAiCatalog() {
  // Return cached if available
  if (customAiCatalogCache !== null) {
    return customAiCatalogCache;
  }

  const catalog = {};
  const examples = {};

  if (!existsSync(CUSTOM_SLIDE_TYPES_DIR)) {
    customAiCatalogCache = catalog;
    customAiExamplesCache = examples;
    return catalog;
  }

  const stat = statSync(CUSTOM_SLIDE_TYPES_DIR);
  if (!stat.isDirectory()) {
    customAiCatalogCache = catalog;
    customAiExamplesCache = examples;
    return catalog;
  }

  const files = readdirSync(CUSTOM_SLIDE_TYPES_DIR).filter((f) => {
    if (!f.endsWith('.js')) return false;
    if (f.startsWith('.')) return false;
    if (f.startsWith('_')) return false;
    return true;
  });

  for (const file of files) {
    const typeName = file.replace(/\.js$/, '');
    const filePath = join(CUSTOM_SLIDE_TYPES_DIR, file);

    try {
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(fileUrl);
      const def = mod.default;

      if (!def || typeof def !== 'object') {
        continue;
      }

      // Check if this slide type has AI metadata
      if (def.ai && typeof def.ai === 'object') {
        const aiDef = def.ai;

        // Validate required AI fields
        if (!aiDef.description) {
          console.warn(
            `[custom-ai-loader] Skipping AI metadata for ${typeName}: missing 'description'`
          );
          continue;
        }

        // Build the AI catalog entry
        catalog[typeName] = {
          category: aiDef.category || 'content',
          resolveInPhase1: aiDef.resolveInPhase1 === true,
          description: aiDef.description,
          bestFor: Array.isArray(aiDef.bestFor) ? aiDef.bestFor : [],
          notFor: Array.isArray(aiDef.notFor) ? aiDef.notFor : [],
          schema: aiDef.schema || {},
          // Mark as custom for potential filtering
          isCustom: true,
          // Store themeId if present (for theme-aware AI suggestions)
          themeId: def.themeId || null,
        };

        // Store examples if provided
        if (Array.isArray(aiDef.examples) && aiDef.examples.length > 0) {
          examples[typeName] = aiDef.examples;
        }

        console.log(`[custom-ai-loader] Loaded AI metadata for: ${typeName}`);
      }
    } catch (err) {
      console.error(`[custom-ai-loader] Error loading ${file}:`, err.message);
    }
  }

  customAiCatalogCache = catalog;
  customAiExamplesCache = examples;

  return catalog;
}

/**
 * Load custom AI examples
 * @returns {Promise<Object>} Map of type-name -> examples array
 */
export async function loadCustomAiExamples() {
  // Ensure catalog is loaded first (populates both caches)
  if (customAiExamplesCache === null) {
    await loadCustomAiCatalog();
  }
  return customAiExamplesCache;
}

/**
 * Clear the custom AI catalog cache (useful for development/hot-reload)
 */
export function clearCustomAiCatalogCache() {
  customAiCatalogCache = null;
  customAiExamplesCache = null;
}

/**
 * Get custom slide types that are tied to a specific theme
 * @param {string} themeId - The theme ID to filter by
 * @returns {Promise<Object>} Filtered catalog entries
 */
export async function getCustomAiCatalogForTheme(themeId) {
  const catalog = await loadCustomAiCatalog();

  // Return all custom types that either:
  // 1. Have no themeId (universal custom types)
  // 2. Match the specified themeId
  return Object.fromEntries(
    Object.entries(catalog).filter(
      ([, def]) => !def.themeId || def.themeId === themeId
    )
  );
}
