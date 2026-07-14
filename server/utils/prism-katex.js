/**
 * Shared utilities for Prism.js code highlighting and KaTeX math rendering
 * in server-rendered HTML exports (PNG, print, etc).
 */

const PRISM_VERSION = '1.29.0';
const KATEX_VERSION = '0.16.9';

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
 * Generate CDN link/script tags for Prism.js and KaTeX.
 * Returns an HTML string to be inserted in <head>.
 */
export function buildPrismKatexCdnTags() {
  const prismBase = `https://cdn.jsdelivr.net/npm/prismjs@${PRISM_VERSION}`;
  const katexBase = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}`;

  const languageScripts = PRISM_LANGUAGES
    .map(lang => `    <script src="${prismBase}/components/prism-${lang}.min.js"></script>`)
    .join('\n');

  return `<!-- Prism.js for code syntax highlighting -->
    <link rel="stylesheet" href="${prismBase}/themes/prism-tomorrow.min.css" />
    <script src="${prismBase}/prism.min.js"></script>
${languageScripts}
    <!-- KaTeX for math rendering -->
    <link rel="stylesheet" href="${katexBase}/dist/katex.min.css" />
    <script src="${katexBase}/dist/katex.min.js"></script>`;
}

/**
 * Generate the inline JavaScript that initializes Prism.js and KaTeX
 * on the rendered page. Returns a string (without <script> tags).
 */
export function buildPrismKatexInitScript() {
  return `// Initialize code highlighting with Prism
        if (typeof Prism !== 'undefined') {
          const codeBlocks = document.querySelectorAll('.md-code-block code');
          for (const block of codeBlocks) {
            try { Prism.highlightElement(block); } catch (e) {}
          }
        }
        // Initialize math rendering with KaTeX
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
        }`;
}

/**
 * Generate a complete <script> block with the Prism/KaTeX initialization.
 * Returns an HTML string.
 */
export function buildPrismKatexInitScriptTag() {
  return `<script>
      (function() {
        ${buildPrismKatexInitScript()}
      })();
    </script>`;
}
