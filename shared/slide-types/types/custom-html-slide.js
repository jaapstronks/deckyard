/**
 * Custom HTML slide type.
 *
 * A first-class "escape hatch" slide: the author writes raw HTML and scoped CSS
 * and gets pixel control for bespoke layouts (org charts, connected diagrams,
 * one-off compositions) that no typed slide captures. Renders isomorphically, so
 * it works identically in the live editor, present mode, audience follow-along,
 * the public /p/ share viewer, and the Puppeteer PNG/PDF/OG export paths.
 *
 * Security model:
 * - The HTML is sanitized on every render via sanitizeSlideHtmlSync(): rich
 *   structural markup + SVG/MathML are allowed; <script>, inline event handlers,
 *   iframes/objects/embeds, forms, and external <link>/<style> are stripped.
 *   JavaScript is therefore never executed on any path (including Puppeteer,
 *   which *would* run scripts but receives none).
 * - The CSS is scoped to this slide's root so it cannot restyle the deck chrome,
 *   and is filtered for @import / expression() / </style> breakouts.
 * - Authoring the raw markup is gated to users with the canEditCustomHtml
 *   capability (enforced server-side in the write routes); everyone else can
 *   still view/present/export the rendered slide read-only.
 */

import { esc, bgClass, BACKGROUND_FIELD } from '../helpers.js';
import { sanitizeSlideHtmlSync } from '../../sanitize.js';
import { filterCssText } from '../../css-filter.js';

const HTML_MAX = 20000;
const CSS_MAX = 10000;

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
 * @param {string} scope - e.g. '.custom-html-root[data-chr="<id>"]'
 * @returns {string}
 */
function scopeCss(css, scope) {
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

const DEFAULT_HTML = `<div class="ch-center">
  <h2 class="ch-title">Custom HTML</h2>
  <p class="ch-sub">Write your own HTML and CSS for full pixel control.</p>
</div>`;

const DEFAULT_CSS = `.ch-center {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
}
.ch-title { font-size: 3rem; font-weight: 800; }
.ch-sub { opacity: 0.7; }`;

export default {
  label: 'Custom HTML',
  fields: [
    {
      key: 'html',
      label: 'HTML',
      type: 'code',
      required: false,
      maxLength: HTML_MAX,
      capability: 'customHtml',
      helpText:
        'Raw HTML for this slide. Scripts, iframes and forms are removed; structural HTML and SVG are kept. Theme tokens (var(--t-accent), …) are available.',
    },
    {
      key: 'css',
      label: 'CSS',
      type: 'code',
      required: false,
      maxLength: CSS_MAX,
      capability: 'customHtml',
      helpText:
        'CSS for this slide. Automatically scoped to the slide so it cannot affect the rest of the deck.',
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: { html: DEFAULT_HTML, css: DEFAULT_CSS, background: 'lime' },
    'en-GB': { html: DEFAULT_HTML, css: DEFAULT_CSS, background: 'lime' },
  },
  defaults: { html: DEFAULT_HTML, css: DEFAULT_CSS, background: 'lime' },
  renderHtml: (content, slide) => {
    const bg = bgClass(content?.background || 'lime');
    const id = String(slide?.id || 'custom');
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '') || 'custom';
    const scope = `.custom-html-root[data-chr="${safeId}"]`;

    const safeHtml = sanitizeSlideHtmlSync(
      String(content?.html || '').slice(0, HTML_MAX)
    );
    const rawCss = String(content?.css || '').slice(0, CSS_MAX);
    const scopedCss = rawCss ? scopeCss(filterCssText(rawCss), scope) : '';
    const styleBlock = scopedCss ? `<style>${scopedCss}</style>` : '';

    const inner = safeHtml || '<div class="custom-html-empty">Custom HTML</div>';

    return `<div class="slide slide-custom-html ${bg}">${styleBlock}<div class="custom-html-root" data-chr="${esc(safeId)}">${inner}</div></div>`;
  },
};
