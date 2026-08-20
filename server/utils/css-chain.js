/**
 * The CSS chain: one assembly order for every render path, fork seam last.
 *
 * Deckyard renders a deck through eight paths (PDF, PNG, standalone HTML,
 * print, single-slide render, MCP preview, embed). Each used to concatenate
 * its own stylesheets in its own order, which is how screen/export drift
 * starts. `buildCssChain()` is the single place that order lives, and it is
 * the only thing that can append the fork seam — so the seam is structurally
 * last, not last-by-convention.
 *
 * **The seam.** `custom/styles/*.css` is a fork-level extension point, the
 * third lever next to `--t-*` theme variables and `custom/slide-types/*.js`.
 * It loads *after* core CSS and can therefore override anything. That is
 * deliberate: it replaces the core-file patch a fork would otherwise carry,
 * minus the merge conflict. It is fork-level (a file on disk, in the fork's
 * git, through code review) and never theme-level — a theme is a database row
 * a user edits, and `themeVarsCssText()` filters it down to `--t-*` values on
 * purpose. See docs/reference/fork-setup.md.
 *
 * Files are read in filename order (`00-…` before `10-…`), so a fork controls
 * its own internal cascade the way `client/styles/` does. `@import` is not
 * resolved: drop the extra file in the directory instead.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger.js';

const log = createLogger('css-chain');

/** Banner that precedes the seam in every assembled chain (also a test handle). */
export const CUSTOM_STYLES_BANNER =
  '/* custom/styles — fork seam, loaded last (see server/utils/css-chain.js) */';

/** dir -> concatenated CSS text. Custom CSS is read once per process. */
const cache = new Map();

/**
 * Where the fork seam lives.
 *
 * @param {string} repoRoot - Repository root path
 * @returns {string} Absolute path to `custom/styles/`
 */
function customStylesDir(repoRoot) {
  return path.join(repoRoot, 'custom', 'styles');
}

/**
 * Read and concatenate `custom/styles/*.css`, in filename order.
 *
 * Synchronous on purpose: the chain builder is called from sync template
 * renderers (`renderEmbedHtmlDocument`) as well as async export builders, and
 * one loader with one cache beats two that can drift. The result is cached per
 * directory, so a fork restarts the server after editing its CSS — the same
 * deal as `custom/slide-types/`.
 *
 * Never throws: an unreadable file is logged and skipped, so a typo in a fork's
 * stylesheet cannot take an export down.
 *
 * @param {string} repoRoot - Repository root path
 * @returns {string} Concatenated CSS ('' when the directory is absent or empty)
 */
export function readCustomStylesCss(repoRoot) {
  const dir = customStylesDir(repoRoot);
  const hit = cache.get(dir);
  if (hit !== undefined) return hit;

  let css = '';
  if (existsSync(dir)) {
    let names = [];
    try {
      names = readdirSync(dir)
        .filter((n) => n.toLowerCase().endsWith('.css'))
        .sort();
    } catch (err) {
      log.error(`cannot read ${dir}: ${err.message}`);
    }
    const parts = [];
    for (const name of names) {
      try {
        parts.push(readFileSync(path.join(dir, name), 'utf8'));
      } catch (err) {
        log.error(`cannot read ${path.join(dir, name)}: ${err.message}`);
      }
    }
    css = parts.join('\n').trim();
  }

  cache.set(dir, css);
  return css;
}

/**
 * Assemble a render path's CSS: its own layers in cascade order, fork seam last.
 *
 * Callers pass every stylesheet layer they contribute — core bundle, theme
 * vars, path-specific document CSS, page chrome — and get one CSS string back.
 * Nothing can follow the seam, because nothing else appends to the result.
 *
 * The one thing that legitimately lands after this string is a *post-cascade*
 * rewrite: `gradient-raster.js` measures the resolved cascade (this chain, seam
 * included) and then replaces the gradients it found with bitmaps. That is not
 * another opinion about styling, it is the answer to the one this chain gave.
 *
 * @param {string} repoRoot - Repository root path
 * @param {Array<string|null|undefined|false>} layers - Cascade order, core first
 * @returns {string} CSS text for a single `<style>` block
 */
export function buildCssChain(repoRoot, layers) {
  const core = (Array.isArray(layers) ? layers : [layers])
    .filter((layer) => typeof layer === 'string' && layer.trim())
    .join('\n');
  const custom = readCustomStylesCss(repoRoot);
  return custom ? `${core}\n${CUSTOM_STYLES_BANNER}\n${custom}` : core;
}
