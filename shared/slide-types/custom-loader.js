/**
 * Custom Slide Type Loader
 *
 * Discovers and loads slide type definitions from the /custom/slide-types/ directory.
 * This allows forks to add organization-specific slide types without modifying core code.
 *
 * Custom slide types are loaded at startup and merged with core types.
 * The custom directory is gitignored in the OSS repo but tracked in forks.
 */

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the repo root (two levels up from shared/slide-types/)
const REPO_ROOT = resolve(__dirname, '..', '..');
const CUSTOM_SLIDE_TYPES_DIR = join(REPO_ROOT, 'custom', 'slide-types');

/**
 * Load all custom slide type definitions from /custom/slide-types/
 * @returns {Promise<Object>} Map of type-name -> slide type definition
 */
export async function loadCustomSlideTypes() {
  if (!existsSync(CUSTOM_SLIDE_TYPES_DIR)) {
    return {};
  }

  // Check it's actually a directory
  const stat = statSync(CUSTOM_SLIDE_TYPES_DIR);
  if (!stat.isDirectory()) {
    console.warn('[custom-loader] custom/slide-types exists but is not a directory');
    return {};
  }

  const files = readdirSync(CUSTOM_SLIDE_TYPES_DIR).filter((f) => {
    // Only load .js files, skip hidden files and non-JS
    if (!f.endsWith('.js')) return false;
    if (f.startsWith('.')) return false;
    if (f.startsWith('_')) return false; // Convention: underscore = private/helper
    return true;
  });

  const customTypes = {};

  for (const file of files) {
    const typeName = file.replace(/\.js$/, '');
    const filePath = join(CUSTOM_SLIDE_TYPES_DIR, file);

    try {
      // Convert to file:// URL for cross-platform dynamic import
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(fileUrl);

      // Expect default export to be the slide type definition
      const def = mod.default;
      if (!def || typeof def !== 'object') {
        console.warn(
          `[custom-loader] Skipping ${file}: no valid default export`
        );
        continue;
      }

      // Basic validation: must have at least a label
      if (!def.label) {
        console.warn(
          `[custom-loader] Skipping ${file}: missing 'label' property`
        );
        continue;
      }

      customTypes[typeName] = def;
      console.log(`[custom-loader] Loaded custom slide type: ${typeName}`);
    } catch (err) {
      console.error(`[custom-loader] Error loading ${file}:`, err.message);
    }
  }

  return customTypes;
}

/**
 * Get the custom slide types directory path (for documentation/debugging)
 */
export function getCustomSlideTypesDir() {
  return CUSTOM_SLIDE_TYPES_DIR;
}