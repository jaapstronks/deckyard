/**
 * Recipe helpers: defaults, validation, and a content hash so the registry can
 * detect when a recipe itself has drifted (not just its source dependencies).
 *
 * A recipe is a plain object describing how to deterministically reproduce one
 * screenshot. The SAME shape is intended to drive the later video factory — a
 * video recipe adds a capture sequence on top of the same state/navigate/action
 * fields (see capture/README.md).
 *
 * @typedef {object} Recipe
 * @property {string} id            Stable slug; matches the registry entry id sans "shot-".
 * @property {string} output        Output filename, e.g. "theme-editor-full.png".
 * @property {string} registryPath  Full path as it appears in the website registry,
 *                                   e.g. "public/images/screenshots/theme-editor-full.png".
 * @property {import('./browser.js').Viewport} [viewport]
 * @property {boolean} [fullPage]   Capture the whole scrollable page (default false).
 * @property {(api: import('./api.js').ApiClient) => Promise<object>} [state]
 *                                   Seed deterministic data; returns a context object.
 * @property {string | ((ctx: object) => string)} navigate
 *                                   Path (relative to base) to open, optionally from context.
 * @property {string} [waitFor]     CSS selector that signals "fully rendered".
 * @property {(page: import('puppeteer-core').Page, ctx: object) => Promise<void>} [action]
 *                                   Optional pre-shot browser steps (clicks, hovers).
 * @property {Record<string, string>} [localStorage]
 *                                   Key/value pairs seeded before app scripts run
 *                                   (e.g. to suppress one-time hints/coach-marks).
 * @property {(api: import('./api.js').ApiClient, ctx: object) => Promise<void>} [cleanup]
 *                                   Optional teardown after the shot.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Resolve the navigate target for a recipe given its seed context.
 * @param {Recipe} recipe
 * @param {object} ctx
 * @returns {string}
 */
export function resolveNavigate(recipe, ctx) {
  const nav = typeof recipe.navigate === 'function' ? recipe.navigate(ctx) : recipe.navigate;
  if (!nav || typeof nav !== 'string') {
    throw new Error(`Recipe "${recipe.id}" produced an empty navigate target`);
  }
  return nav;
}

/**
 * Validate the minimal shape so a broken recipe fails with a clear message
 * rather than deep inside Puppeteer.
 * @param {Recipe} recipe
 */
export function validateRecipe(recipe) {
  const problems = [];
  if (!recipe || typeof recipe !== 'object') return ['recipe is not an object'];
  if (!recipe.id) problems.push('missing "id"');
  if (!recipe.output) problems.push('missing "output"');
  if (!recipe.registryPath) problems.push('missing "registryPath"');
  if (!recipe.navigate) problems.push('missing "navigate"');
  if (recipe.output && !recipe.registryPath?.endsWith(recipe.output)) {
    problems.push(
      `"output" (${recipe.output}) is not the basename of "registryPath" (${recipe.registryPath})`
    );
  }
  return problems;
}

/**
 * Content hash of the recipe's own source file. Stored in the registry as part
 * of the `recipe` reference so a changed recipe body shows up as drift.
 * @param {string} moduleFsPath absolute path to the recipe .js file
 * @returns {string} short hex hash
 */
export function hashRecipeFile(moduleFsPath) {
  const src = fs.readFileSync(moduleFsPath, 'utf8');
  return crypto.createHash('sha256').update(src).digest('hex').slice(0, 16);
}
