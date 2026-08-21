/**
 * Shared utilities for Prism.js code highlighting and KaTeX math rendering
 * in server-rendered HTML exports (PNG, print, etc).
 *
 * Both libraries are loaded from a public CDN, so every tag emitted here is a
 * third-party request the reader's browser makes. Callers that know what a deck
 * contains should therefore pass the result of `detectPrismKatexNeeds()` so a
 * deck without code or math loads nothing at all.
 */

import { resolvePrismComponents } from '../../shared/prism-languages.js';

const PRISM_VERSION = '1.29.0';
const KATEX_VERSION = '0.16.9';

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
 * Generate CDN link/script tags for Prism.js and KaTeX.
 *
 * Returns one tag per line at column zero: the head chain
 * (server/utils/head-chain.js) owns indentation, so a fragment that
 * hand-indents for one caller's template shape lands ragged in the next.
 *
 * @param {object} [options]
 * @param {boolean} [options.prism=true] Emit the Prism tags.
 * @param {boolean} [options.katex=true] Emit the KaTeX tags.
 * @param {string[]|null} [options.languages=null] Deck languages; null loads
 *   the default ten-language set.
 */
export function buildPrismKatexCdnTags({
  prism = true,
  katex = true,
  languages = null,
} = {}) {
  const prismBase = `https://cdn.jsdelivr.net/npm/prismjs@${PRISM_VERSION}`;
  const katexBase = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}`;

  const parts = [];

  if (prism) {
    parts.push(
      '<!-- Prism.js for code syntax highlighting -->',
      `<link rel="stylesheet" href="${prismBase}/themes/prism-tomorrow.min.css" />`,
      `<script src="${prismBase}/prism.min.js"></script>`,
      ...resolvePrismComponents(languages).map(
        (lang) =>
          `<script src="${prismBase}/components/prism-${lang}.min.js"></script>`,
      ),
    );
  }

  if (katex) {
    parts.push(
      '<!-- KaTeX for math rendering -->',
      `<link rel="stylesheet" href="${katexBase}/dist/katex.min.css" />`,
      `<script src="${katexBase}/dist/katex.min.js"></script>`,
    );
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
