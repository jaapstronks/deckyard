/**
 * One immutable fork root for the process. Entrypoints load .env before importing
 * this module. Without an override, render helpers can use an installation root
 * for fixtures; import-time loaders use this checkout.
 */

import { isAbsolute, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, one level up from `shared/`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Reject relative overrides: startup tools can run from different directories.
const OVERRIDE = (() => {
  const value = process.env.DECKYARD_CUSTOM_DIR;
  if (!value) return null;
  if (!isAbsolute(value)) {
    throw new Error(
      `DECKYARD_CUSTOM_DIR must be an absolute path, got: ${value}`,
    );
  }
  return value;
})();

/**
 * Resolve the fork root, honoring the process override for every installation.
 * @param {string} [repoRoot] - Installation root; defaults to this checkout
 * @returns {string} Absolute path to the fork root
 */
export function customDirFor(repoRoot = REPO_ROOT) {
  return OVERRIDE ?? join(repoRoot, 'custom');
}

// Import-time loaders share the same process root as rendering and serving.
const PROCESS_CUSTOM_DIR = customDirFor();

/** Slide type definitions (`custom/slide-types/*.js`). */
export const CUSTOM_SLIDE_TYPES_DIR = join(PROCESS_CUSTOM_DIR, 'slide-types');

/** AI catalog and prompt overrides (`custom/ai/*.js`). */
export const CUSTOM_AI_DIR = join(PROCESS_CUSTOM_DIR, 'ai');

/** Fork font declarations. */
export const CUSTOM_FONTS_FILE = join(PROCESS_CUSTOM_DIR, 'fonts.js');

/** Pinned font files, same shape as `scripts/google-fonts.lock.json`. */
export const CUSTOM_FONTS_LOCK_PATH = join(
  PROCESS_CUSTOM_DIR,
  'google-fonts.lock.json',
);

/** The fork's MCP tool registrar. */
export const CUSTOM_MCP_TOOLS_FILE = join(PROCESS_CUSTOM_DIR, 'mcp-tools.js');
