/**
 * Where this installation's fork customizations live.
 *
 * `custom/` is one unit, not a loose set of directories: a fork drops in slide
 * types, the CSS those types render against, themes, assets, fonts, AI copy
 * and MCP tools together, and `docs/reference/fork-setup.md` describes them
 * that way. So the location is declared here once, and every loader derives
 * its own path from it. A per-loader derivation could disagree with its
 * neighbours — a type loaded from one root with its stylesheet read from
 * another renders unstyled, with nothing to report.
 *
 * `DECKYARD_CUSTOM_DIR` moves the whole root, which is what lets a process
 * load a fork from outside the checkout: the MCP stdio test boots with a fork
 * slide type installed without writing into the shared working tree, where a
 * parallel worker scans and reads the files it would be creating and deleting
 * (`tests/no-escape-markdown-aliases.test.js` walks `custom/`).
 *
 * Node reads `process.env` per process, so the root is a property of the
 * process you start: it resolves on import and does not change afterwards.
 */

import { isAbsolute, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root, one level up from `shared/`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The override, validated once at import time.
 *
 * A relative path is refused rather than resolved against the current working
 * directory: these loaders run from several cwds (server boot, MCP stdio
 * child, test runner, the scaffolder), so a relative one would name a
 * different directory per caller. This is operator configuration, so it fails
 * the process rather than degrading — unlike fork *content*, where one bad
 * file is skipped with its report so the engine keeps serving every other
 * deck (see `slide-types/custom-loader.js`).
 */
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
 * The fork root for a given installation root.
 *
 * Render paths that are handed a root (the CSS chain, themes, assets) resolve
 * through here rather than joining `'custom'` themselves, so the override
 * governs them too: with it set, the whole installation reads one fork root,
 * whichever root a caller passes.
 *
 * @param {string} [repoRoot] - Installation root; defaults to this checkout
 * @returns {string} Absolute path to the fork root
 */
export function customDirFor(repoRoot = REPO_ROOT) {
  return OVERRIDE ?? join(repoRoot, 'custom');
}

/** The fork root this process reads customizations from. */
export const CUSTOM_DIR = customDirFor();

/** Slide type definitions (`custom/slide-types/*.js`). */
export const CUSTOM_SLIDE_TYPES_DIR = join(CUSTOM_DIR, 'slide-types');

/** Stylesheets shipped alongside those types (`custom/styles/*.css`). */
export const CUSTOM_STYLES_DIR = join(CUSTOM_DIR, 'styles');

/** Fork themes, either `<id>/theme.json` or the flat `<id>.json`. */
export const CUSTOM_THEMES_DIR = join(CUSTOM_DIR, 'themes');

/** Fork assets served under `/custom/assets/`. */
export const CUSTOM_ASSETS_DIR = join(CUSTOM_DIR, 'assets');

/** AI catalog and prompt overrides (`custom/ai/*.js`). */
export const CUSTOM_AI_DIR = join(CUSTOM_DIR, 'ai');

/** Fork font declarations. */
export const CUSTOM_FONTS_FILE = join(CUSTOM_DIR, 'fonts.js');

/** Pinned font files, same shape as `scripts/google-fonts.lock.json`. */
export const CUSTOM_FONTS_LOCK_PATH = join(
  CUSTOM_DIR,
  'google-fonts.lock.json',
);

/** The fork's MCP tool registrar. */
export const CUSTOM_MCP_TOOLS_FILE = join(CUSTOM_DIR, 'mcp-tools.js');
