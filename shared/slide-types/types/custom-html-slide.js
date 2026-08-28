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
 * - The CSS is scoped to this slide's root so it cannot restyle the deck chrome
 *   (`scopeCss`, shared with the Settings > Slide Types path), and is filtered
 *   for @import / expression() / </style> breakouts.
 * - Authoring the raw markup is gated to users with the canEditCustomHtml
 *   capability (enforced server-side in the write routes); everyone else can
 *   still view/present/export the rendered slide read-only.
 */

import { escapeHtml, bgClass, BACKGROUND_FIELD } from '../helpers.js';
import { sanitizeSlideHtmlSync } from '../../sanitize.js';
import { filterCssText } from '../../css-filter.js';
import { scopeCss } from '../scope-css.js';

const HTML_MAX = 20000;
const CSS_MAX = 10000;

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
  structure: 'singleton',
  fallback: 'content-slide',
  runtime: 'static',
  label: 'Custom HTML',
  // Deliberately not offered to agents (see server/utils/ai/slide-catalog/
  // agent-catalog.js): authoring the raw markup is gated behind the
  // canEditCustomHtml capability, and an escape hatch is only worth its
  // sanitizer budget when a human chose it. Agents pick a typed slide.
  ai: false,
  fields: [
    {
      key: 'html',
      label: 'HTML',
      type: 'code',
      required: false,
      maxLength: HTML_MAX,
      capability: 'customHtml',
      helpText:
        'Raw HTML for this slide. Scripts, iframes and forms are removed; structural HTML and SVG are kept. Theme tokens (var(--t-color-accent), …) are available.',
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
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: { html: DEFAULT_HTML, css: DEFAULT_CSS, background: 'lime' },
  renderHtml: (content, slide) => {
    const bg = bgClass(content?.background || 'lime');
    const id = String(slide?.id || 'custom');
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '') || 'custom';
    const scope = `.custom-html-root[data-chr="${safeId}"]`;

    const safeHtml = sanitizeSlideHtmlSync(
      String(content?.html || '').slice(0, HTML_MAX),
    );
    const rawCss = String(content?.css || '').slice(0, CSS_MAX);
    const scopedCss = rawCss ? scopeCss(filterCssText(rawCss), scope) : '';
    const styleBlock = scopedCss ? `<style>${scopedCss}</style>` : '';

    const inner =
      safeHtml || '<div class="custom-html-empty">Custom HTML</div>';

    return `<div class="slide slide-custom-html ${bg}">${styleBlock}<div class="custom-html-root" data-chr="${escapeHtml(safeId)}">${inner}</div></div>`;
  },
};
