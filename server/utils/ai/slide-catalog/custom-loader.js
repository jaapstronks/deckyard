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
 * - examples: Array of example content objects (optional)
 * - usage: String with the organization's own rules for filling this type
 *   (optional; normalized and truncated, see shared/slide-types/usage.js)
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { clampUsage } from '../../../../shared/slide-types/usage.js';
import { createLogger } from '../../logger.js';

const log = createLogger('custom-ai-loader');

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

        // Validate required AI fields. `description` stays mandatory because it
        // is what the picker and the agent lean on hardest — but say out loud
        // that `usage` goes down with it, since a fork author who wrote only a
        // usage rule would otherwise get silence.
        if (!aiDef.description) {
          log.warn(
            `Skipping AI metadata for ${typeName}: missing 'description'` +
              (aiDef.usage ? " (its 'usage' rule is dropped with it)" : '')
          );
          continue;
        }

        // A fork written against the old contract may still carry `ai.schema`.
        // The shape now comes from the type's own `fields[]`, so the block is
        // ignored — said out loud, because silently dropping it is how a fork
        // ends up wondering why its constraints stopped reaching the model.
        if (aiDef.schema && typeof aiDef.schema === 'object') {
          log.warn(
            `Ignoring 'ai.schema' on ${typeName}: the agent-facing ` +
              'schema is derived from the type definition\'s fields[]. Move any ' +
              'constraint you need onto the field itself, and use `ai: false` on a ' +
              'field you do not want agents to fill.'
          );
        }

        // Build the AI catalog entry
        catalog[typeName] = {
          category: aiDef.category || 'content',
          resolveInPhase1: aiDef.resolveInPhase1 === true,
          description: aiDef.description,
          bestFor: Array.isArray(aiDef.bestFor) ? aiDef.bestFor : [],
          notFor: Array.isArray(aiDef.notFor) ? aiDef.notFor : [],
          // Truncated rather than rejected: a rule that runs long should lose
          // its tail, not take a working slide type down with it. A non-string
          // (a function, an object) normalizes to null and is simply absent.
          usage: clampUsage(aiDef.usage),
          // Mark as custom for potential filtering
          isCustom: true,
          // Store themeId if present (for theme-aware AI suggestions)
          themeId: def.themeId || null,
        };

        // Store examples if provided
        if (Array.isArray(aiDef.examples) && aiDef.examples.length > 0) {
          examples[typeName] = aiDef.examples;
        }

        log.info(`Loaded AI metadata for: ${typeName}`);
      }
    } catch (err) {
      log.error(`Error loading ${file}:`, err.message);
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
