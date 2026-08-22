/**
 * Shared utilities for Prism.js code highlighting and KaTeX math rendering
 * in server-rendered HTML (exports, PNG/PDF render paths, embeds, previews).
 *
 * **Both libraries come from `client/vendor/`, never from a CDN.** They are
 * npm dependencies pinned by package-lock.json and copied into the tree by
 * `scripts/vendor-prism-katex.js` (sha256 per file in `manifest.json`), which
 * is the same copy the app shell loads. There is therefore no version literal
 * in this file: the version is whatever the lockfile resolves.
 *
 * A document reaches those bytes one of two ways, and the caller knows which:
 *
 * - **`mode: 'linked'`** — the document is served by this server, so
 *   `/client/vendor/…` resolves against its own origin. The browser caches the
 *   files across decks.
 * - **`mode: 'inlined'`** — the document has no origin to resolve against: a
 *   downloaded `*.html` opened from disk, or a string handed to
 *   `page.setContent()`. The vendor files are read from disk and emitted as
 *   `<style>`/`<script>` bodies, and KaTeX's fonts are base64'd into its CSS
 *   (decision D46) — a relative `url(fonts/…)` has nothing to resolve against
 *   in such a document, so the formulas would render in a fallback face.
 *
 * Callers pass what the rendered slides actually need
 * (`detectPrismKatexNeeds()`), so a deck without code or math carries nothing
 * at all and a deck with code carries no KaTeX fontset.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PRISM_BASE_COMPONENTS,
  resolvePrismComponents,
} from '../../shared/prism-languages.js';

/**
 * Where the vendored copies live, resolved from this module rather than from a
 * caller's `repoRoot`. They ship with the server code and are not a fork-level
 * extension point (unlike `custom/styles/`), so every caller would otherwise
 * have to thread a root through only to name the same directory.
 */
const VENDOR_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'client',
  'vendor',
);

/** The URL prefix the same directory is served at (`SHARED_PUBLIC_DIRS`). */
const VENDOR_URL = '/client/vendor';

/** The two ways a document can reach the vendored bytes. */
export const PRISM_KATEX_MODES = Object.freeze(['linked', 'inlined']);

/**
 * Work out which of Prism/KaTeX a rendered deck actually needs, by looking at
 * the markup the slide renderers produced. This is the same markup the init
 * script below queries, so the two can't disagree: Prism runs over
 * `.md-code-block code` and KaTeX over `.md-math-block` / `.md-math-inline`.
 *
 * @param {string} html Rendered slide HTML.
 * @returns {{prism: boolean, katex: boolean, languages: string[]}}
 */
export function detectPrismKatexNeeds(html) {
  const s = typeof html === 'string' ? html : '';
  const prism = /class="[^"]*\bmd-code-block\b/.test(s);
  const katex = /class="[^"]*\bmd-math-(?:block|inline)\b/.test(s);
  const languages = [];
  if (prism) {
    for (const m of s.matchAll(/class="language-([\w+-]+)"/g)) {
      const lang = m[1].toLowerCase();
      if (!languages.includes(lang)) languages.push(lang);
    }
  }
  return { prism, katex, languages };
}

/**
 * The vendored files a deck needs, in load order.
 *
 * Prism's CDN bundle (`prism.min.js`) does not exist in the vendor tree: it is
 * core plus four components, which is exactly what the app shell's lazy loader
 * assembles too (`shared/prism-languages.js` § PRISM_BASE_COMPONENTS). Ordering
 * matters — these are plain scripts and a component needs its dependencies
 * evaluated first.
 *
 * @param {boolean} prism
 * @param {boolean} katex
 * @param {string[]|null} languages
 * @returns {Array<{kind: 'css'|'js', rel: string, label?: string}>}
 */
function vendorFilesFor(prism, katex, languages) {
  const files = [];
  if (prism) {
    const components = [
      ...PRISM_BASE_COMPONENTS,
      ...resolvePrismComponents(languages),
    ].filter((name, i, all) => all.indexOf(name) === i);
    files.push({
      kind: 'css',
      rel: 'prism/themes/prism-tomorrow.min.css',
      label: 'Prism.js for code syntax highlighting',
    });
    files.push({ kind: 'js', rel: 'prism/components/prism-core.min.js' });
    for (const name of components) {
      files.push({ kind: 'js', rel: `prism/components/prism-${name}.min.js` });
    }
  }
  if (katex) {
    files.push({
      kind: 'css',
      rel: 'katex/katex.min.css',
      label: 'KaTeX for math rendering',
    });
    files.push({ kind: 'js', rel: 'katex/katex.min.js' });
  }
  return files;
}

/** rel path -> file text, read once per process (the files never change). */
const textCache = new Map();

/**
 * Read one vendored file, cached.
 *
 * Synchronous for the same reason `readCustomStylesCss()` is: this is called
 * from a sync template renderer (`renderEmbedHtmlDocument`) as well as from
 * async export builders, and one loader with one cache beats two that drift.
 *
 * @param {string} rel Path below `client/vendor/`
 * @returns {string}
 */
function readVendorText(rel) {
  const hit = textCache.get(rel);
  if (hit !== undefined) return hit;
  const text = fs.readFileSync(path.join(VENDOR_DIR, rel), 'utf8');
  textCache.set(rel, text);
  return text;
}

/** rel path -> the CSS with its `url()` references resolved for inlining. */
const inlineCssCache = new Map();

/**
 * KaTeX's stylesheet, with its fonts base64'd into it.
 *
 * `katex.min.css` carries 60 relative `url(fonts/…)` references to 20 files.
 * In a document with no origin every one of them is a dead reference, and
 * KaTeX's glyph metrics assume its own faces — so a formula laid out in a
 * fallback font is visibly wrong, not merely differently styled. Decision D46:
 * inline the fontset, and only on the path that carries formulas.
 *
 * Only the woff2 source survives: it is the only format vendored (every engine
 * that can open one of these documents supports woff2), so the woff/ttf
 * alternates would be dead references again.
 *
 * @param {string} rel
 * @returns {string} CSS with no external references left
 */
function readVendorCssForInlining(rel) {
  const hit = inlineCssCache.get(rel);
  if (hit !== undefined) return hit;

  const dir = path.dirname(path.join(VENDOR_DIR, rel));
  const css = readVendorText(rel)
    // Drop the woff/ttf alternates that follow each woff2 in a `src:` list.
    .replace(/,url\([^)]+\.(?:woff|ttf)\)\s*format\("[^"]*"\)/g, '')
    .replace(/url\(([^)"']+\.woff2)\)/g, (whole, ref) => {
      try {
        const buf = fs.readFileSync(path.join(dir, ref));
        return `url(data:font/woff2;base64,${buf.toString('base64')})`;
      } catch {
        // A missing font is a re-vendor problem, not a reason to fail the
        // export: leave the reference alone and let the formula fall back.
        return whole;
      }
    });

  inlineCssCache.set(rel, css);
  return css;
}

/**
 * Neutralise a closing tag that would end the block early.
 *
 * `</script>` inside a JS string (or `</style>` inside a CSS one) closes the
 * element it is embedded in, so an inlined library could truncate the
 * document. Neither vendored file contains one today; a re-vendor is exactly
 * the moment that would change silently.
 *
 * @param {string} text
 * @param {'script'|'style'} tag
 * @returns {string}
 */
function escapeClosingTag(text, tag) {
  return text.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
}

/**
 * Generate the `<link>`/`<script>` (or `<style>`/`<script>`) tags for Prism.js
 * and KaTeX, from the vendored copies.
 *
 * Returns one tag per line at column zero: the head chain
 * (server/utils/head-chain.js) owns indentation, so a fragment that
 * hand-indents for one caller's template shape lands ragged in the next.
 *
 * @param {object} options
 * @param {'linked'|'inlined'} options.mode Required — see the module docstring.
 *   There is no default: a caller that guesses wrong either ships a dead
 *   reference or an unnecessary megabyte, and only the caller knows whether its
 *   document has an origin.
 * @param {boolean} [options.prism=true] Emit the Prism tags.
 * @param {boolean} [options.katex=true] Emit the KaTeX tags.
 * @param {string[]|null} [options.languages=null] Deck languages; null loads
 *   the default ten-language set.
 * @returns {string} Head markup, or '' when neither library is wanted.
 */
export function buildPrismKatexTags({
  mode,
  prism = true,
  katex = true,
  languages = null,
} = {}) {
  if (!PRISM_KATEX_MODES.includes(mode)) {
    throw new Error(
      `buildPrismKatexTags: unknown mode "${mode}" — one of ${PRISM_KATEX_MODES.join('/')}`,
    );
  }

  const parts = [];
  for (const file of vendorFilesFor(prism, katex, languages)) {
    if (file.label) parts.push(`<!-- ${file.label} (self-hosted) -->`);
    if (mode === 'linked') {
      parts.push(
        file.kind === 'css'
          ? `<link rel="stylesheet" href="${VENDOR_URL}/${file.rel}" />`
          : `<script src="${VENDOR_URL}/${file.rel}"></script>`,
      );
    } else if (file.kind === 'css') {
      parts.push(
        `<style>${escapeClosingTag(readVendorCssForInlining(file.rel), 'style')}</style>`,
      );
    } else {
      parts.push(
        `<script>${escapeClosingTag(readVendorText(file.rel), 'script')}</script>`,
      );
    }
  }

  return parts.join('\n');
}

/**
 * The inline JavaScript that initialises Prism.js and KaTeX on the rendered
 * page. Returns a bare body at column zero, without `<script>` tags — the
 * script chain (server/utils/script-chain.js) wraps and indents it.
 *
 * There used to be a second exported spelling that returned the same body
 * already wrapped in a `<script>`, and a third caller that hand-rewrote that
 * wrapper character for character. One shape, one meaning.
 *
 * @param {object} [options]
 * @param {boolean} [options.prism=true] Include the Prism init.
 * @param {boolean} [options.katex=true] Include the KaTeX init.
 * @returns {string} JavaScript source, or '' when neither library is wanted.
 */
export function buildPrismKatexInitScript({ prism = true, katex = true } = {}) {
  const parts = [];
  if (prism) {
    parts.push(`// Initialize code highlighting with Prism
if (typeof Prism !== 'undefined') {
  const codeBlocks = document.querySelectorAll('.md-code-block code');
  for (const block of codeBlocks) {
    try { Prism.highlightElement(block); } catch {}
  }
}`);
  }
  if (katex) {
    parts.push(`// Initialize math rendering with KaTeX
if (typeof katex !== 'undefined') {
  const mathBlocks = document.querySelectorAll('.md-math-block[data-math]');
  for (const block of mathBlocks) {
    const latex = block.dataset.math;
    if (!latex) continue;
    try { katex.render(latex, block, { displayMode: true, throwOnError: false, errorColor: '#c41a16' }); } catch {}
  }
  const mathInlines = document.querySelectorAll('.md-math-inline[data-math]');
  for (const span of mathInlines) {
    const latex = span.dataset.math;
    if (!latex) continue;
    try { katex.render(latex, span, { displayMode: false, throwOnError: false, errorColor: '#c41a16' }); } catch {}
  }
}`);
  }
  return parts.join('\n\n');
}
