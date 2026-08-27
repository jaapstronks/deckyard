/**
 * Custom Slide Type Loader
 *
 * Discovers and loads slide type definitions from the /custom/slide-types/ directory.
 * This allows forks to add organization-specific slide types without modifying core code.
 *
 * Custom slide types are loaded at startup and merged with core types.
 * The custom directory is gitignored in the OSS repo but tracked in forks.
 */

import {
  formatDefinitionReport,
  validateSlideTypeDefinition,
} from './validate-definition.js';

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
 *
 * Every file is run through {@link validateSlideTypeDefinition} after import.
 * Warnings are logged and the type still registers; a definition with hard
 * errors is **skipped with its report**, because a type that cannot render is
 * worse in the deck than absent from the picker. The process is never taken
 * down: one bad file in a fork must not stop the engine from serving every
 * other deck.
 *
 * @param {object} [options]
 * @param {string[]} [options.globalFieldKeys] - `GLOBAL_SLIDE_FIELD_KEYS`,
 *   passed in by the registry. It cannot be imported here: the registry reaches
 *   this module mid-evaluation, so the import would be a cycle.
 * @returns {Promise<Object>} Map of type-name -> slide type definition
 */
export async function loadCustomSlideTypes({ globalFieldKeys = [] } = {}) {
  if (!existsSync(CUSTOM_SLIDE_TYPES_DIR)) {
    return {};
  }

  // Check it's actually a directory
  const stat = statSync(CUSTOM_SLIDE_TYPES_DIR);
  if (!stat.isDirectory()) {
    console.warn(
      '[custom-loader] custom/slide-types exists but is not a directory',
    );
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

      // The definition schema, not the content schema: a typo'd field.type or a
      // missing renderHtml used to load fine and fail per slide at render time.
      const report = validateSlideTypeDefinition(def, typeName, {
        globalFieldKeys,
      });
      if (report.errors.length || report.warnings.length) {
        const verdict = report.errors.length
          ? 'REFUSED'
          : 'loaded with warnings';
        console.warn(
          `[custom-loader] ${file} — ${verdict}\n` +
            formatDefinitionReport(report).join('\n'),
        );
      }
      if (report.errors.length) continue;

      customTypes[typeName] = def;
      // stderr, not stdout: this module is imported by tools whose stdout is a
      // data contract (`i18n-fill.js --report` emits JSON there), and a fork
      // installed locally would otherwise corrupt output that is clean in CI.
      console.warn(`[custom-loader] Loaded custom slide type: ${typeName}`);
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
