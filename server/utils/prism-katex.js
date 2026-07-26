/**
 * Shared utilities for Prism.js code highlighting and KaTeX math rendering
 * in server-rendered HTML exports (PNG, print, etc).
 *
 * Both libraries are loaded from a public CDN, so every tag emitted here is a
 * third-party request the reader's browser makes. Callers that know what a deck
 * contains should therefore pass the result of `detectPrismKatexNeeds()` so a
 * deck without code or math loads nothing at all.
 */

const PRISM_VERSION = '1.29.0';
const KATEX_VERSION = '0.16.9';

/**
 * The language set loaded when a caller does not say which languages a deck
 * uses. Kept as-is for the render paths (PNG/PDF/print) that still emit one
 * fixed head for every deck.
 */
const PRISM_LANGUAGES = [
  'markup',
  'css',
  'javascript',
  'typescript',
  'python',
  'java',
  'json',
  'sql',
  'bash',
  'markdown',
];

/**
 * Languages the default `prism.min.js` bundle already ships with. Requesting a
 * component script for one of these would be a wasted request.
 */
const PRISM_CORE_LANGUAGES = new Set([
  'markup',
  'html',
  'xml',
  'svg',
  'mathml',
  'ssml',
  'atom',
  'rss',
  'css',
  'clike',
  'javascript',
  'js',
]);

/**
 * Language name (as written in a fenced code block) → the Prism component
 * scripts it needs, in load order. Components with dependencies list them
 * first, because the scripts are plain (non-module) tags that run in order.
 *
 * A language that is not in this map simply gets no component script: it
 * renders as an unhighlighted code block, exactly as an unknown language did
 * when the head hardcoded ten packs.
 */
const PRISM_LANGUAGE_COMPONENTS = {
  bash: ['bash'],
  sh: ['bash'],
  shell: ['bash'],
  zsh: ['bash'],
  c: ['c'],
  cpp: ['c', 'cpp'],
  csharp: ['csharp'],
  cs: ['csharp'],
  diff: ['diff'],
  docker: ['docker'],
  dockerfile: ['docker'],
  go: ['go'],
  golang: ['go'],
  graphql: ['graphql'],
  ini: ['ini'],
  java: ['java'],
  json: ['json'],
  jsx: ['jsx'],
  kotlin: ['kotlin'],
  kt: ['kotlin'],
  markdown: ['markdown'],
  md: ['markdown'],
  php: ['markup-templating', 'php'],
  python: ['python'],
  py: ['python'],
  r: ['r'],
  ruby: ['ruby'],
  rb: ['ruby'],
  rust: ['rust'],
  rs: ['rust'],
  sass: ['sass'],
  scss: ['scss'],
  sql: ['sql'],
  swift: ['swift'],
  toml: ['toml'],
  tsx: ['jsx', 'typescript', 'tsx'],
  typescript: ['typescript'],
  ts: ['typescript'],
  yaml: ['yaml'],
  yml: ['yaml'],
};

/**
 * Resolve deck language names to the Prism component names to load.
 *
 * @param {string[]|null} languages Language names as written in the deck, or
 *   null for "unknown, load the default set".
 * @returns {string[]} Prism component names, deduped, in dependency order.
 */
function resolvePrismComponents(languages) {
  if (!Array.isArray(languages)) return PRISM_LANGUAGES.slice();
  const out = [];
  for (const raw of languages) {
    const name = String(raw || '').toLowerCase().trim();
    if (!name || PRISM_CORE_LANGUAGES.has(name)) continue;
    const components = PRISM_LANGUAGE_COMPONENTS[name];
    if (!components) continue;
    for (const c of components) if (!out.includes(c)) out.push(c);
  }
  return out;
}

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
 * Returns an HTML string to be inserted in <head>.
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
    const languageScripts = resolvePrismComponents(languages)
      .map(
        (lang) =>
          `    <script src="${prismBase}/components/prism-${lang}.min.js"></script>`
      )
      .join('\n');
    parts.push(
      `<!-- Prism.js for code syntax highlighting -->
    <link rel="stylesheet" href="${prismBase}/themes/prism-tomorrow.min.css" />
    <script src="${prismBase}/prism.min.js"></script>${
      languageScripts ? `\n${languageScripts}` : ''
    }`
    );
  }

  if (katex) {
    parts.push(
      `<!-- KaTeX for math rendering -->
    <link rel="stylesheet" href="${katexBase}/dist/katex.min.css" />
    <script src="${katexBase}/dist/katex.min.js"></script>`
    );
  }

  return parts.join('\n    ');
}

/**
 * Generate the inline JavaScript that initializes Prism.js and KaTeX
 * on the rendered page. Returns a string (without <script> tags).
 *
 * @param {object} [options]
 * @param {boolean} [options.prism=true] Include the Prism init.
 * @param {boolean} [options.katex=true] Include the KaTeX init.
 */
export function buildPrismKatexInitScript({ prism = true, katex = true } = {}) {
  const parts = [];
  if (prism) {
    parts.push(`// Initialize code highlighting with Prism
        if (typeof Prism !== 'undefined') {
          const codeBlocks = document.querySelectorAll('.md-code-block code');
          for (const block of codeBlocks) {
            try { Prism.highlightElement(block); } catch (e) {}
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
            try { katex.render(latex, block, { displayMode: true, throwOnError: false, errorColor: '#c41a16' }); } catch (e) {}
          }
          const mathInlines = document.querySelectorAll('.md-math-inline[data-math]');
          for (const span of mathInlines) {
            const latex = span.dataset.math;
            if (!latex) continue;
            try { katex.render(latex, span, { displayMode: false, throwOnError: false, errorColor: '#c41a16' }); } catch (e) {}
          }
        }`);
  }
  return parts.join('\n        ');
}

/**
 * Generate a complete <script> block with the Prism/KaTeX initialization.
 * Returns an HTML string, or '' when neither library is wanted.
 *
 * @param {object} [options] Same shape as `buildPrismKatexInitScript`.
 */
export function buildPrismKatexInitScriptTag(options) {
  const body = buildPrismKatexInitScript(options);
  if (!body) return '';
  return `<script>
      (function() {
        ${body}
      })();
    </script>`;
}
