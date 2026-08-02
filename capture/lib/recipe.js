/**
 * Recipe helpers: defaults, validation, and a content hash over the recipe's
 * module graph so the registry can detect when a recipe — or a factory it
 * builds on — has drifted.
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
 * @property {string} [clip]        CSS selector to shoot instead of the page. Use for
 *                                   "pure slide" shots where the surrounding app chrome
 *                                   is not the subject — the presenter toolbar around a
 *                                   live poll, say. Mutually exclusive with `fullPage`.
 * @property {(api: import('./api.js').ApiClient, ctx: object) => Promise<void>} [cleanup]
 *                                   Optional teardown after the shot.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { init as initLexer, parse as parseModule } from 'es-module-lexer';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Directory the graph walk stays inside, repo-relative. */
export const DEFAULT_RECIPE_SCOPE = 'capture';

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
  if (recipe.clip && recipe.fullPage) {
    problems.push('"clip" and "fullPage" are mutually exclusive');
  }
  return problems;
}

/**
 * Resolve one import specifier to a file inside the graph, or null when it
 * does not belong there.
 *
 * Only path-like specifiers are followed: a bare specifier is a package and a
 * `node:` specifier is the runtime, and neither is source we hash. Missing
 * extensions and directory imports are resolved the way Node would, so a
 * future `./helpers` or `./helpers/` still lands on a real file.
 *
 * @param {string} specifier
 * @param {string} fromDir directory of the importing module
 * @returns {string | null} absolute path, or null if not a walkable module
 */
function resolveImport(specifier, fromDir) {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const base = path.resolve(fromDir, specifier);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Collect every module reachable from `entry` that lives inside `scopeDir`.
 *
 * Imports are read with a real ES module lexer rather than a regex: a regex for
 * `import(...)` also matches the `import('./x.js')` inside a JSDoc type
 * annotation, which pulls the whole server into the graph. The lexer sees
 * comments for what they are.
 *
 * @param {string} entryFsPath absolute path to the entry module
 * @param {string} scopeDir absolute directory the walk stays inside
 * @returns {Promise<string[]>} absolute paths, unsorted, deduplicated
 */
async function collectGraph(entryFsPath, scopeDir) {
  await initLexer;
  const seen = new Set();
  const queue = [entryFsPath];
  while (queue.length) {
    const fsPath = queue.pop();
    if (seen.has(fsPath)) continue;
    seen.add(fsPath);
    const src = fs.readFileSync(fsPath, 'utf8');
    const [imports] = parseModule(src, fsPath);
    for (const imp of imports) {
      // `n` is undefined for a dynamic import with a computed specifier —
      // nothing static to follow.
      if (!imp.n) continue;
      const resolved = resolveImport(imp.n, path.dirname(fsPath));
      if (!resolved) continue;
      // Out of scope: not hashed, and not walked either. Following it would
      // drag in `shared/` and `server/`, whose churn would mark every recipe
      // stale almost daily — a gate that is always red gets ignored.
      if (!isInside(resolved, scopeDir)) continue;
      queue.push(resolved);
    }
  }
  return [...seen];
}

/**
 * @param {string} fsPath
 * @param {string} dir
 * @returns {boolean}
 */
function isInside(fsPath, dir) {
  const rel = path.relative(dir, fsPath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Content hash of a recipe's whole module graph within `scope`. Stored in the
 * registry as part of the `recipe` reference, so a changed recipe body *or* a
 * changed shared factory shows up as drift.
 *
 * The scope boundary is the point: sixteen of the seventeen recipes import a
 * shared factory, so hashing the entry module alone guards almost nothing —
 * but walking past `capture/` reaches ~122 modules whose churn has nothing to
 * do with the screenshot. See `capture/README.md` § Known limits.
 *
 * @param {string} moduleFsPath absolute path to the recipe .js file
 * @param {{ scope?: string }} [opts] `scope` is repo-relative, default `capture`
 * @returns {Promise<string>} short hex hash, 16 chars (same format as before)
 */
export async function hashRecipeGraph(moduleFsPath, { scope = DEFAULT_RECIPE_SCOPE } = {}) {
  const scopeDir = path.resolve(REPO_ROOT, scope);
  const files = await collectGraph(moduleFsPath, scopeDir);
  // Sort by repo-relative path so the hash is independent of traversal order.
  const entries = files
    .map((fsPath) => ({
      rel: path.relative(REPO_ROOT, fsPath).split(path.sep).join('/'),
      src: fs.readFileSync(fsPath, 'utf8'),
    }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = crypto.createHash('sha256');
  for (const { rel, src } of entries) {
    hash.update(rel);
    hash.update('\0');
    hash.update(src);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
