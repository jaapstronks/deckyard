/**
 * Where a fork's custom slide types live.
 *
 * Two loaders read that directory — the registry loader
 * (`./custom-loader.js`) and the AI-metadata loader
 * (`server/utils/ai/slide-catalog/custom-loader.js`) — and until this module
 * existed each one walked up from its own file to the repo root and joined
 * `custom/slide-types` itself. Two derivations of one location is one too
 * many: they can disagree, and neither can be pointed somewhere else.
 *
 * The location is therefore declared here, once. It defaults to
 * `<repo>/custom/slide-types`, and `DECKYARD_CUSTOM_SLIDE_TYPES_DIR` overrides
 * it with an absolute path. That override is what lets a process load a fork's
 * types from outside the checkout — which is how the MCP stdio test boots with
 * a fork type installed without writing into the shared working tree, where a
 * parallel guard test is reading the very files it would create and delete.
 *
 * Node reads `process.env` per process, so the override is a property of the
 * process you start, not something to flip at runtime: this module resolves it
 * on import.
 */

import { isAbsolute, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root, two levels up from `shared/slide-types/`. */
const REPO_ROOT = resolve(__dirname, '..', '..');

/** The directory this process loads custom slide types from. */
export const CUSTOM_SLIDE_TYPES_DIR = resolveCustomSlideTypesDir();

/**
 * Resolve the directory once, at import time.
 *
 * An override that is not absolute is refused rather than quietly resolved
 * against the current working directory: the loaders run from several cwds
 * (server boot, MCP stdio child, test runner), so a relative path would mean
 * a different directory per caller.
 *
 * @returns {string} Absolute path to the custom slide types directory
 */
function resolveCustomSlideTypesDir() {
  const override = process.env.DECKYARD_CUSTOM_SLIDE_TYPES_DIR;
  if (!override) return join(REPO_ROOT, 'custom', 'slide-types');
  if (!isAbsolute(override)) {
    throw new Error(
      `DECKYARD_CUSTOM_SLIDE_TYPES_DIR must be an absolute path, got: ${override}`,
    );
  }
  return override;
}
