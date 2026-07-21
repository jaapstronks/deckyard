/**
 * Custom AI Catalog Override Loader
 *
 * Lets a downstream fork *override the AI prompt copy of a core slide type*
 * without patching the OSS catalog. This is the "override" half of the seam:
 * `custom/slide-types/*.js` already *adds* whole new types (see
 * `custom-loader.js`); this loader lets a fork replace the `description` /
 * `bestFor` / `notFor` that a **core** type contributes to the generation
 * prompt, while the core type keeps its schema, `allowedIcons`, category, etc.
 *
 * Drop a `custom/ai/catalog.js` in the repo root whose default export maps a
 * core type name to a partial override:
 *
 *   export default {
 *     // only the keys you set are overridden; the rest of the core entry stays
 *     'content-slide': {
 *       description: '...your tuned description...',
 *       bestFor: ['...'],
 *       notFor: ['...'],
 *     },
 *   };
 *
 * The merge (`mergeCustomAiCatalog` in `definitions.js`) overlays each partial
 * onto the matching core entry, so overriding one field leaves the others
 * intact. This mirrors the prompt seam (`custom/ai/prompts.js`) and the other
 * fork loaders: the folder is gitignored in OSS and tracked in a fork.
 *
 * Only object-valued entries whose key matches a known type are accepted;
 * anything else is ignored with a warning so a typo fails loud rather than
 * silently seeding a phantom type into the prompt.
 */

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the repo root (five levels up from server/utils/ai/slide-catalog/).
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_CUSTOM_CATALOG_FILE = join(REPO_ROOT, 'custom', 'ai', 'catalog.js');

/** The partial-override keys a fork may set on a core catalog entry. */
const OVERRIDABLE_FIELDS = new Set([
  'description',
  'bestFor',
  'notFor',
  'category',
  'resolveInPhase1',
]);

/**
 * Load fork-supplied core-type catalog overrides.
 *
 * Never throws: a missing file, a bad export, or an import error all resolve to
 * an empty map, leaving the OSS core catalog copy in force.
 *
 * @param {Object} [options]
 * @param {string} [options.file] - Override file path (for tests).
 * @param {Set<string>|string[]} [options.knownTypes] - Accepted type names;
 *   entries outside this set are ignored with a warning. When omitted, every
 *   object-valued entry is accepted.
 * @returns {Promise<Record<string, Object>>} Map of type name → partial override.
 */
export async function loadCustomCatalogOverrides({ file = DEFAULT_CUSTOM_CATALOG_FILE, knownTypes = null } = {}) {
  if (!existsSync(file)) return {};

  const allow = knownTypes
    ? knownTypes instanceof Set
      ? knownTypes
      : new Set(knownTypes)
    : null;

  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err) {
    console.error(`[custom-ai-catalog] failed to load ${file}:`, err.message);
    return {};
  }

  const overrides = mod?.default;
  if (!overrides || typeof overrides !== 'object') {
    console.warn('[custom-ai-catalog] custom/ai/catalog.js default export is not an object; ignoring');
    return {};
  }

  const clean = {};
  for (const [type, value] of Object.entries(overrides)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      console.warn(`[custom-ai-catalog] override "${type}" is not an object; ignoring`);
      continue;
    }
    if (allow && !allow.has(type)) {
      console.warn(`[custom-ai-catalog] override "${type}" does not match a known slide type; ignoring`);
      continue;
    }
    // Keep only the recognised override fields so a stray key can't smuggle
    // unexpected shape into a core entry.
    const partial = {};
    for (const [k, v] of Object.entries(value)) {
      if (OVERRIDABLE_FIELDS.has(k)) partial[k] = v;
      else console.warn(`[custom-ai-catalog] override "${type}.${k}" is not an overridable field; ignoring`);
    }
    if (Object.keys(partial).length === 0) continue;
    clean[type] = partial;
    console.log(`[custom-ai-catalog] overriding core slide type copy: ${type} (${Object.keys(partial).join(', ')})`);
  }

  return clean;
}
