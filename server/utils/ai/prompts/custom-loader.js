/**
 * Custom AI Prompt Loader
 *
 * Lets a downstream fork override the tuned AI prompt copy without patching the
 * OSS pipeline. Drop a `custom/ai/prompts.js` in the repo root whose default
 * export is a map of `{ builderName: fn }`. Each function replaces the
 * same-named base builder from `./base/index.js` (base-then-overlay: custom
 * wins, base is the fallback for every builder you don't override).
 *
 * Example `custom/ai/prompts.js`:
 *
 *   export default {
 *     // same signature as the base builder it replaces
 *     buildPhase1SystemPrompt({ detectedLang, requestedLang, targetSlides }) {
 *       return `...your tuned outline prompt...`;
 *     },
 *   };
 *
 * This mirrors the other fork loaders (custom slide types, custom MCP tools,
 * custom themes): the folder is gitignored in OSS and tracked in a fork.
 *
 * Only function-valued entries whose key matches a known base builder are
 * accepted; anything else is ignored with a warning so a typo fails loud
 * rather than silently doing nothing.
 */

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the repo root (four levels up from server/utils/ai/prompts/).
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_CUSTOM_PROMPTS_FILE = join(REPO_ROOT, 'custom', 'ai', 'prompts.js');

/**
 * Load fork-supplied prompt-builder overrides.
 *
 * Never throws: a missing file, a bad export, or an import error all resolve to
 * an empty map, leaving the OSS base prompts in force.
 *
 * @param {Object} [options]
 * @param {string} [options.file] - Override file path (for tests).
 * @param {Set<string>|string[]} [options.knownBuilders] - Accepted builder
 *   names; entries outside this set are ignored with a warning. When omitted,
 *   every function-valued entry is accepted.
 * @returns {Promise<Record<string, Function>>}
 */
export async function loadCustomPromptOverrides({ file = DEFAULT_CUSTOM_PROMPTS_FILE, knownBuilders = null } = {}) {
  if (!existsSync(file)) return {};

  const allow = knownBuilders
    ? knownBuilders instanceof Set
      ? knownBuilders
      : new Set(knownBuilders)
    : null;

  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (err) {
    console.error(`[custom-ai-prompts] failed to load ${file}:`, err.message);
    return {};
  }

  const overrides = mod?.default;
  if (!overrides || typeof overrides !== 'object') {
    console.warn('[custom-ai-prompts] custom/ai/prompts.js default export is not an object; ignoring');
    return {};
  }

  const clean = {};
  for (const [name, value] of Object.entries(overrides)) {
    if (typeof value !== 'function') {
      console.warn(`[custom-ai-prompts] override "${name}" is not a function; ignoring`);
      continue;
    }
    if (allow && !allow.has(name)) {
      console.warn(`[custom-ai-prompts] override "${name}" does not match a known prompt builder; ignoring`);
      continue;
    }
    clean[name] = value;
    console.log(`[custom-ai-prompts] using custom prompt builder: ${name}`);
  }

  return clean;
}
