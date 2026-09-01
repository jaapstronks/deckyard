/**
 * DB-backed custom slide types: the isomorphic half.
 *
 * A type built in Settings > Slide Types is a database record, not a module —
 * `{ slug, template, css, fields, defaults }`. Turning that record into markup
 * needs four steps in a fixed order (compile, sanitize, filter+scope the author
 * CSS, put the scope root on the markup), and it needs the registry key the
 * record is resolved under. Neither step touches storage or the process-wide
 * `SLIDE_TYPES` map, so both live here rather than on the server, where the
 * Settings preview could not reach them.
 *
 * That reach is the point. Before B192 the preview iframe carried its own
 * regex mini-implementation of the template language and injected the author
 * CSS unscoped, so what the maker saw was not what the deck rendered — two
 * renderers for one meaning. The server's {@link
 * module:server/utils/custom-slide-type-runtime} keeps what genuinely belongs
 * to it (`toRuntimeSlideType`, `buildMergedSlideTypes`) and calls in here for
 * the render itself; the preview calls the same function with the same
 * arguments.
 *
 * @see docs/reference/slide-type-css-contract.md
 */

import { compileTemplate } from './template-compiler.js';
import { sanitizeSlideHtmlSync } from '../sanitize.js';
import { filterCssText } from '../css-filter.js';
import { scopeCss } from './scope-css.js';
import { slideRootClass } from './validate-definition.js';

/**
 * The registry key a DB-backed custom slide type is stored and resolved under.
 *
 * `custom-` prefixes the org's own slug so a builder-UI type can never shadow a
 * registered one. This is the single derivation of that key: the editor's
 * `/api/slide-types` response, the render registry, the storage write seam and
 * the Settings preview all have to agree on the exact string a slide stores,
 * and four copies of one template literal is four ways for them to drift.
 *
 * @param {{ slug?: string }} ct - Custom slide type record from the database
 * @returns {string}
 */
export function customSlideTypeKey(ct) {
  return `custom-${ct?.slug}`;
}

/**
 * The class the type's author CSS is scoped under, and that its rendered root
 * element carries. Derived from {@link customSlideTypeKey} so the render path
 * and the preview cannot disagree about it.
 *
 * @param {{ slug?: string }} ct - Custom slide type record from the database
 * @returns {string} e.g. `slide-custom-hero`
 */
export function customSlideTypeRootClass(ct) {
  return slideRootClass(customSlideTypeKey(ct));
}

/** HTML elements that cannot hold children, so they cannot host a <style>. */
const VOID_TAGS =
  /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

/**
 * Build the renderer for one DB-backed custom slide type's template.
 *
 * The template is compiled on **first render**, not here: `buildMergedSlideTypes`
 * also builds the registry the storage write seam validates against, and a deck
 * save has no business compiling every published template in the org just to
 * learn that a type key exists (B129). The scoped `<style>` block is memoized
 * the same way — it depends only on the definition.
 *
 * @param {Object} def - The stored definition
 * @param {string} def.template - Template source
 * @param {string} [def.css] - Author CSS, unfiltered and unscoped
 * @param {string} def.rootClass - {@link customSlideTypeRootClass} for the type
 * @returns {(content: Object) => string} Renderer taking slide content
 */
export function createTemplateSlideRenderer({ template, css, rootClass }) {
  let render = null;
  let styleBlock = null;

  return (content) => {
    render ??= compileTemplate(template);
    // Sanitize the compiled template output before it reaches innerHTML and
    // the headless-export renderer. Template authoring is canManage-gated, but
    // the *content* the template interpolates ({{raw}} / {{markdown}}) is
    // authored by lower-privilege editors / AI / imports and gets no HTML
    // validation on write — so an innocent-looking {{raw description}} would
    // otherwise be stored XSS reaching present mode, follow-along, the public
    // /p/ viewer and the server-side Puppeteer export. Mirrors the custom-html
    // slide (security-audit H5; also closes the {{markdown}} javascript: sink,
    // M1).
    const html = sanitizeSlideHtmlSync(render(content || {}));
    // Author CSS gets the security filter *and* the containment pass, the same
    // pair the custom-html slide runs. Scoping happens after sanitizing because
    // sanitizeSlideHtmlSync strips <style>, and the scope root has to exist on
    // the markup before the block can name it (B189).
    styleBlock ??= buildStyleBlock(css, rootClass);
    return withScopeRoot(html, rootClass, styleBlock);
  };
}

/**
 * @param {string} [css] - Author CSS
 * @param {string} rootClass - Scope root class
 * @returns {string} `<style>…</style>`, or '' when the type has no CSS
 */
function buildStyleBlock(css, rootClass) {
  if (!css) return '';
  const scoped = scopeCss(filterCssText(css), `.${rootClass}`);
  return scoped ? `<style>${scoped}</style>` : '';
}

/**
 * Give a rendered DB slide type's markup the scope root its CSS is written
 * against: the root element carries `rootClass` and the `<style>` block is its
 * first child.
 *
 * A DB template is free-form markup, so unlike a file-JS type there is nothing
 * to warn at — the root class has to be *put* there, or the scoped selectors
 * match nothing and the slide renders unstyled. The template's own outermost
 * element is that root whenever it has one; only markup that opens with text or
 * a void element gets a wrapper, and then the wrapper is a real `.slide` so the
 * output keeps its single-root shape.
 *
 * That single root matters beyond CSS: `renderSlideElement` mounts
 * `wrap.firstElementChild` and copies its class list, so markup whose first
 * element was the `<style>` block — what this path emitted before B189 — mounted
 * the stylesheet instead of the slide.
 *
 * @param {string} html - Sanitized template output
 * @param {string} rootClass - e.g. `slide-custom-hero`
 * @param {string} styleBlock - `<style>…</style>`, or '' when the type has no CSS
 * @returns {string}
 */
function withScopeRoot(html, rootClass, styleBlock) {
  const body = String(html || '');
  const open = /^\s*<([a-zA-Z][\w-]*)\b[^>]*>/.exec(body);
  if (open && !VOID_TAGS.test(open[1])) {
    const tag = open[0];
    const rest = body.slice(open.index + tag.length);
    const withClass = /\sclass="/.test(tag)
      ? tag.replace(/\sclass="([^"]*)"/, ` class="$1 ${rootClass}"`)
      : tag.replace(/^<([a-zA-Z][\w-]*)/, `<$1 class="${rootClass}"`);
    return body.slice(0, open.index) + withClass + styleBlock + rest;
  }
  return `<div class="slide ${rootClass}">${styleBlock}${body}</div>`;
}
