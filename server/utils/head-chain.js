/**
 * The head chain: one `<!doctype html>`, one `<head>`, for every render path.
 *
 * The CSS chain (server/utils/css-chain.js) gave the render paths one assembly
 * order for their stylesheets. Everything *around* that `<style>` stayed
 * hand-written: twelve document openings, no two alike. What that cost, before
 * this module existed:
 *
 *   - `<html dir>` was set by four paths and forgotten by four others, so an
 *     RTL deck rendered left-to-right in print, PDF and PNG.
 *   - The embed resolved its language with a second, weaker spelling
 *     (`detectLang`) that could not return an RTL code at all — an `ar` deck
 *     came out `lang="nl" dir="rtl"`, the two attributes contradicting each
 *     other inside one tag.
 *   - Adding anything head-shaped (a CSP, an OG tag, a `theme-color`) meant
 *     editing twelve templates and getting all twelve right, with no test that
 *     could say which one was missed.
 *
 * `buildDocumentHead()` is the single place that opening lives. It takes what a
 * path actually differs in — its title, its extra tags, its stylesheets — and
 * emits the rest identically every time. `dir` is *derived* from `lang` rather
 * than accepted alongside it, which is why the two can no longer disagree.
 *
 * **Scope.** Doctype through `</head>`, inclusive, plus the `<html>` open tag
 * (which carries `lang`/`dir`, so it belongs to the same decision). The `<body>`
 * is the path's own business. The CSS *inside* the `<style>` is still assembled
 * by `buildCssChain` — this module places the block, it does not fill it.
 */

import { escapeHtml } from './html-utils.js';
import { getDocDir } from './doc-lang.js';

const INDENT = '    ';

/**
 * Assemble a document opening: doctype, `<html>` and a complete `<head>`.
 *
 * @param {Object} options
 * @param {string} options.lang - Document language, from
 *   `resolveDocLangFromPresentation()`. The one spelling; `dir` follows from it.
 * @param {Record<string, string>} [options.htmlAttrs] - Extra attributes on the
 *   `<html>` element (the embed's `data-theme`). Values are escaped.
 * @param {string} [options.title] - Raw title text; escaped here. Omitted when
 *   empty, so a path that is only ever screenshotted can skip it.
 * @param {string} [options.description] - Raw meta description; escaped here.
 * @param {string} [options.robots] - `<meta name="robots">` content, e.g.
 *   `'noindex,nofollow'`. Omitted when empty.
 * @param {boolean} [options.viewport=true] - Emit the responsive viewport meta.
 * @param {Array<string|null|undefined|false>} [options.head] - Raw HTML
 *   fragments to place after the metas, in order (external font tags, Prism/
 *   KaTeX CDN tags, canonical/OG markup passed in by a route). Falsy entries
 *   are dropped rather than emitted as blank lines.
 * @param {Array<string|null|undefined|false>} [options.stylesheets] - Hrefs for
 *   `<link rel="stylesheet">`, for served pages that link core CSS instead of
 *   inlining it.
 * @param {Array<{id?: string, css: string}|string|null|undefined|false>} [options.styles]
 *   Inline `<style>` blocks, in cascade order. The last one is where the fork
 *   seam lands, so a caller puts its `buildCssChain()` result last — the seam
 *   test pins that nothing stylesheet-shaped follows it.
 * @returns {string} `<!doctype html>` through `</head>`, no trailing newline
 */
export function buildDocumentHead({
  lang,
  htmlAttrs = {},
  title = '',
  description = '',
  robots = '',
  viewport = true,
  head = [],
  stylesheets = [],
  styles = [],
} = {}) {
  const docLang = String(lang || '');
  const docDir = getDocDir(docLang);

  const attrs = [
    `lang="${escapeHtml(docLang)}"`,
    `dir="${escapeHtml(docDir)}"`,
    ...Object.entries(htmlAttrs || {})
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`),
  ].join(' ');

  // Everything from <meta charset> to the last tag before the first <style>.
  // Indented as a block below, relative indentation preserved, so a caller can
  // hand in a pre-formatted fragment without it landing ragged.
  const lines = ['<meta charset="utf-8" />'];
  if (viewport) {
    lines.push(
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    );
  }
  if (robots) {
    lines.push(
      `<meta name="robots" content="${escapeHtml(String(robots))}" />`,
    );
  }
  if (title) lines.push(`<title>${escapeHtml(String(title))}</title>`);
  if (description) {
    lines.push(
      `<meta name="description" content="${escapeHtml(String(description))}" />`,
    );
  }
  for (const fragment of compact(head)) lines.push(dedent(fragment));
  for (const href of compact(stylesheets)) {
    lines.push(`<link rel="stylesheet" href="${escapeHtml(href)}" />`);
  }

  const indented = lines
    .flatMap((entry) => entry.split('\n'))
    .map((line) => (line ? `${INDENT}${line}` : ''));

  // <style> blocks are emitted separately: their contents stay at column 0, the
  // way every hand-written path already emitted them. Indenting an assembled
  // CSS chain would rewrite every line of every export for no gain.
  for (const block of styles) {
    if (!block) continue;
    const css = typeof block === 'string' ? block : String(block.css || '');
    const id = typeof block === 'string' ? '' : String(block.id || '');
    const open = id ? `<style id="${escapeHtml(id)}">` : '<style>';
    indented.push(
      css.includes('\n')
        ? `${INDENT}${open}\n${css}\n${INDENT}</style>`
        : `${INDENT}${open}${css}</style>`,
    );
  }

  return `<!doctype html>\n<html ${attrs}>\n  <head>\n${indented.join('\n')}\n  </head>`;
}

/**
 * Drop empty entries from a fragment list.
 *
 * @param {Array<string|null|undefined|false>} items
 * @returns {string[]}
 */
function compact(items) {
  return (Array.isArray(items) ? items : [items])
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.replace(/\s+$/, ''));
}

/**
 * Strip a fragment's common leading indentation.
 *
 * Callers assemble their extra head markup as template literals indented to
 * wherever they sit in the source (`buildPrismKatexCdnTags` hands back several
 * tags already indented four spaces). Pasting that into an indented list
 * indents it twice. Removing the common prefix and letting the caller re-indent
 * keeps relative structure while landing the block where it belongs.
 *
 * @param {string} fragment
 * @returns {string}
 */
function dedent(fragment) {
  const lines = fragment.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)[0].length);
  const strip = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(strip)).join('\n');
}
