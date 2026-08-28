/**
 * Scope author-supplied CSS under a slide root.
 *
 * Two paths let a human paste a stylesheet into Deckyard: the custom-html
 * slide (`types/custom-html-slide.js`) and the Settings > Slide Types builder
 * (`server/utils/custom-slide-type-runtime.js`). Both inject it as a `<style>`
 * block on a page that also carries the deck chrome, so an unscoped
 * `body { display: none }` or `.slide-inner { padding: 0 }` restyles the whole
 * presenter, the editor and every other slide.
 *
 * `filterCssText` (shared/css-filter.js) is the *security* half — no `@import`,
 * no `expression()`, no `</style>` breakout. This module is the *containment*
 * half: every selector is rewritten to sit under one root, so author CSS
 * cannot reach anything the author does not own. Run the filter first, then
 * this; the order matters because the filter defangs constructs this parser
 * would otherwise carry through untouched.
 *
 * It is one implementation on purpose. Two custom-CSS paths with two different
 * ideas of what "scoped" means is exactly the drift the beta stance is spent
 * removing (`docs/reference/versioning.md` § The beta stance).
 *
 * Best-effort by design, and honest about it: `@keyframes` / `@font-face` /
 * `@page` bodies are not selector lists and are passed through untouched, so a
 * DB type's `@font-face` is still global. Those declare resources, not
 * appearance of other people's elements.
 *
 * @see docs/reference/slide-type-css-contract.md § Author CSS is scoped to the slide root
 */

/**
 * Split a CSS string into top-level { selector, body } blocks, where body keeps
 * any nested blocks intact (for @media / @supports / @container).
 * @param {string} css
 * @returns {Array<{ selector: string, body: string }>}
 */
function splitTopLevel(css) {
  const blocks = [];
  let depth = 0;
  let buf = '';
  let selector = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') {
      if (depth === 0) {
        selector = buf.trim();
        buf = '';
      } else {
        buf += c;
      }
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth <= 0) {
        if (selector || buf.trim()) blocks.push({ selector, body: buf });
        buf = '';
        selector = '';
        depth = 0;
      } else {
        buf += c;
      }
    } else {
      buf += c;
    }
  }
  return blocks;
}

/**
 * Prefix a single selector with the slide scope, mapping root-ish selectors
 * (:root / html / body) onto the scope itself.
 * @param {string} sel
 * @param {string} scope
 * @returns {string}
 */
function scopeSelector(sel, scope) {
  const s = sel.trim();
  if (!s) return '';
  if (s.startsWith(scope)) return s;
  if (/^(:root|html|body)\b/.test(s)) {
    return s.replace(/^(:root|html|body)/, scope);
  }
  return `${scope} ${s}`;
}

/**
 * Scope author CSS under a per-slide selector so it can't bleed into the rest
 * of the deck. Best-effort: @keyframes / @font-face / @page are left untouched
 * (their bodies aren't selectors); @media / @supports / @container are recursed.
 * @param {string} css
 * @param {string} scope - e.g. '.custom-html-root[data-chr="<id>"]' or '.slide-custom-hero'
 * @returns {string}
 */
export function scopeCss(css, scope) {
  return splitTopLevel(css)
    .map(({ selector, body }) => {
      if (selector.startsWith('@')) {
        const low = selector.toLowerCase();
        if (
          low.startsWith('@media') ||
          low.startsWith('@supports') ||
          low.startsWith('@container')
        ) {
          return `${selector} {\n${scopeCss(body, scope)}\n}`;
        }
        // @keyframes, @font-face, @page, @charset, ... : not selector-scoped.
        return `${selector} {${body}}`;
      }
      const scoped = selector
        .split(',')
        .map((part) => scopeSelector(part, scope))
        .filter(Boolean)
        .join(', ');
      return scoped ? `${scoped} {${body}}` : '';
    })
    .filter(Boolean)
    .join('\n');
}
