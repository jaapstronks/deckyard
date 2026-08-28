/**
 * Custom Slide Type Runtime
 *
 * Converts database-stored custom slide type definitions into runtime
 * slide type objects that can be merged into the SLIDE_TYPES map.
 *
 * Custom types with templates get a compiled renderHtml function.
 * Custom types without templates fall back to their baseType's renderer.
 *
 * ## One registry per organization
 *
 * `SLIDE_TYPES` is the process-wide registry: core plus whatever a fork put in
 * `custom/slide-types/`. It is the same map for every request, so it cannot
 * hold an org's DB-backed types. {@link buildMergedSlideTypes} is the seam that
 * answers "which types does *this* organization have" — and it is the only one.
 * Every server path that resolves a `slides[].type` against anything other than
 * bare `SLIDE_TYPES` takes its map from here, reads and writes alike: the
 * storage write seam (`normalizeSlides`), the export pipeline, the published /
 * embed viewers, the thumbnail and single-slide renderers.
 *
 * Building the map is cheap on purpose — a template is compiled on first
 * render, not on construction — so the write path, which only needs to know
 * whether a key exists, pays a lookup and not a compile (B129).
 */

import { SLIDE_TYPES } from '../../shared/slide-types.js';
import { compileTemplate } from './slide-template-compiler.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';
import { sanitizeSlideHtmlSync } from '../../shared/sanitize.js';
import { filterCssText } from '../../shared/css-filter.js';
import { scopeCss } from '../../shared/slide-types/scope-css.js';
import { slideRootClass } from '../../shared/slide-types/validate-definition.js';
import { listPublishedCustomSlideTypes } from '../storage/custom-slide-types.js';
import { createLogger } from './logger.js';

const log = createLogger('custom-slide-type-runtime');

/**
 * Convert a custom slide type record into a runtime slide type definition.
 *
 * @param {Object} ct - Custom slide type record from the database
 * @returns {Object} Runtime slide type definition (label, fields, defaults, renderHtml)
 */
export function toRuntimeSlideType(ct) {
  const def = {
    label: ct.label,
    fields: ct.fields || [],
    defaults: ct.defaults || {},
    defaultsByLang: ct.defaultsByLang || undefined,
    isCustom: true,
    customId: ct.id,
  };

  if (ct.template) {
    // Compiled on first render, not here: `buildMergedSlideTypes` also builds
    // the registry the storage write seam validates against, and a deck save
    // has no business compiling every published template in the org just to
    // learn that a type key exists.
    let render = null;
    const rootClass = slideRootClass(customSlideTypeKey(ct));
    def.renderHtml = (content, slide, ctx) => {
      render ??= compileTemplate(ct.template);
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
      // Author CSS gets the security filter *and* the containment pass, the
      // same pair the custom-html slide runs. Scoping happens after sanitizing
      // because sanitizeSlideHtmlSync strips <style>, and the scope root has to
      // exist on the markup before the block can name it (B189).
      const scopedCss = ct.css
        ? scopeCss(filterCssText(ct.css), `.${rootClass}`)
        : '';
      const styleBlock = scopedCss ? `<style>${scopedCss}</style>` : '';
      return withScopeRoot(html, rootClass, styleBlock);
    };
  } else if (ct.baseType && SLIDE_TYPES[ct.baseType]) {
    // Fall back to the base type's renderer
    def.renderHtml = SLIDE_TYPES[ct.baseType].renderHtml;
  } else {
    // Last resort: render a basic content block
    def.renderHtml = (content) => {
      const title = escapeHtml(String(content?.title || ct.label || ''));
      const body = escapeHtml(String(content?.body || ''));
      return `
        <div class="slide is-lime">
          <div class="slide-inner">
            <h2 class="heading">${title}</h2>
            ${body ? `<div class="body">${body}</div>` : ''}
          </div>
        </div>
      `;
    };
  }

  return def;
}

/** HTML elements that cannot hold children, so they cannot host a <style>. */
const VOID_TAGS =
  /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

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

/**
 * The registry key a DB-backed custom slide type is stored and resolved under.
 *
 * `custom-` prefixes the org's own slug so a builder-UI type can never shadow a
 * registered one. This is the single derivation of that key: the editor's
 * `/api/slide-types` response, the render registry and the storage write seam
 * all have to agree on the exact string a slide stores, and three copies of one
 * template literal is three ways for them to drift.
 *
 * @param {{ slug: string }} ct - Custom slide type record from the database
 * @returns {string}
 */
export function customSlideTypeKey(ct) {
  return `custom-${ct?.slug}`;
}

/**
 * Build the slide-type registry for one organization: core and file-based
 * types, plus that org's **published** custom types under their
 * {@link customSlideTypeKey}.
 *
 * This is the map every org-aware path resolves against — see the module note
 * on why there is exactly one of them. It is org-scoped by construction, so it
 * is built per request and never cached across organizations.
 *
 * A failed load leaves the core registry intact rather than throwing: on a read
 * path that degrades a custom slide to the unknown-type fallback, and on the
 * write path it degrades to the pre-B129 behaviour (a 400) — both are better
 * than a 500, and neither persists anything wrong.
 *
 * @param {Object} ctx - Context with organizationId (a storage scope qualifies)
 * @returns {Promise<Object>} Merged slide types map
 */
export async function buildMergedSlideTypes(ctx) {
  const merged = { ...SLIDE_TYPES };

  try {
    const customTypes = await listPublishedCustomSlideTypes(ctx);
    for (const ct of customTypes) {
      merged[customSlideTypeKey(ct)] = toRuntimeSlideType(ct);
    }
  } catch (err) {
    log.warn('Failed to load custom slide types:', err.message || err);
  }

  return merged;
}
