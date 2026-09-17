/** Print handout shell and paper styles for the shared reader projection. */

import {
  getSlideType,
  SLIDE_TYPES,
} from '../../shared/slide-types/registry.js';
import { renderSlideSectionHtml } from '../../shared/slide-types/semantic-projection.js';
import { stripFontFacesFromCss } from '../utils/embed-fonts.js';
import { stripLiveOnlySlidesFromPresentation } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { sandboxWatermarkText } from '../config/sandbox.js';
import { escapeHtml } from '../utils/html-utils.js';
import {
  buildPrismKatexTags,
  detectPrismKatexNeeds,
} from '../utils/prism-katex.js';
import { buildScriptChain } from '../utils/script-chain.js';
import { loadExportCssBundle } from './css-bundle.js';
import { buildCssChain } from '../utils/css-chain.js';
import { buildDocumentHead } from '../utils/head-chain.js';

/**
 * The print/handout document itself: reflowed text layout, not slide canvas.
 * It styles the reader's vocabulary (`.reader-*`, the projection's elements)
 * for paper, in the theme's fonts. A layer of the same chain, so the fork seam
 * still lands last (server/utils/css-chain.js).
 */
const PRINT_DOC_CSS = `
      html, body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body { padding: 0; margin: 0; }
      .print-wrap { background: #fff; color: #111; }
      .print-toolbar {
        position: sticky;
        top: 0;
        padding: 12px 16px;
        background: rgba(0,0,0,0.75);
        color: #fff;
        display: flex;
        gap: 12px;
        align-items: center;
        z-index: 10;
      }
      .print-toolbar .btn { border-radius: 6px; }
      .print-watermark {
        font-family: var(--font-mono);
        font-size: 12px;
        opacity: 0.8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 55vw;
      }

      .print-doc {
        max-width: 920px;
        margin: 0 auto;
        padding: 22px 18px 40px;
        counter-reset: print-slide;
        font-size: 14px;
        line-height: 1.6;
      }
      .print-doc h1, .print-doc h2, .print-doc h3 {
        color: #0b0b0b;
        font-family: var(--font-heading);
        font-weight: 600;
      }
      .print-h1 {
        font-size: 30px;
        line-height: 1.15;
        margin: 10px 0 18px;
      }

      /* Empty counter alt text keeps numbering out of accessible names. */
      .print-doc .reader-slide {
        padding: 8px 0 18px;
        border-top: 1px solid rgba(0,0,0,0.12);
        counter-increment: print-slide;
        break-inside: avoid-page;
      }
      .print-doc .reader-slide:first-of-type { border-top: 0; }
      .print-doc .reader-slide > h2 {
        font-size: 20px;
        line-height: 1.2;
        margin: 18px 0 10px;
        break-after: avoid-page;
      }
      .print-doc .reader-slide > h2::before {
        content: counter(print-slide) ". ";
        content: counter(print-slide) ". " / "";
        font-family: var(--font-mono);
        font-size: 13px;
        opacity: 0.65;
      }
      /* A hidden heading is a name, not a title: visually hidden, still an
         <h2> for heading navigation. */
      .print-doc .reader-slide .reader-sr-only {
        position: absolute;
        width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
        overflow: hidden; clip-path: inset(50%); white-space: nowrap;
      }
      .print-doc h3 { font-size: 15px; margin: 14px 0 6px; }
      .print-doc p { margin: 10px 0; }
      .print-doc ul, .print-doc ol { margin: 10px 0; padding-left: 22px; }
      .print-doc li { margin: 6px 0; }
      .print-doc a { color: #0b57d0; text-decoration: underline; }

      .print-doc blockquote {
        margin: 12px 0;
        padding: 2px 0 2px 14px;
        border-left: 3px solid rgba(0,0,0,0.2);
      }
      .print-doc blockquote p {
        font-family: var(--font-heading);
        font-size: 18px;
        line-height: 1.35;
      }
      .print-doc .reader-slide > footer { font-size: 13px; opacity: 0.85; }
      .print-doc .reader-slide > footer p { margin: 2px 0; }
      .print-doc aside {
        margin: 12px 0;
        padding: 6px 12px;
        border: 1px solid rgba(0,0,0,0.15);
        border-radius: 8px;
        break-inside: avoid;
      }
      .reader-summary, .reader-caption { opacity: 0.8; }
      .reader-summary { font-style: italic; }
      .reader-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.7;
      }
      .reader-label dfn { font-style: normal; }
      .print-doc aside .reader-label { margin: 0 0 2px; }

      ul.reader-items { list-style: none; padding-left: 0; }
      ol.reader-items { list-style: decimal; padding-left: 22px; }
      .reader-item, .reader-field {
        margin: 10px 0;
        padding-left: 12px;
        border-left: 3px solid rgba(0,0,0,0.12);
        break-inside: avoid;
      }
      .reader-fields { margin: 10px 0; }
      .reader-field dt { font-weight: 600; font-size: 13px; opacity: 0.75; }
      .reader-field dd { margin: 2px 0 0; }

      .reader-figure { margin: 12px 0; break-inside: avoid; }
      .reader-figure img {
        display: block;
        max-width: 100%;
        max-height: 60vh;
        height: auto;
        border-radius: 6px;
      }
      .reader-figure figcaption { font-size: 13px; opacity: 0.75; margin-top: 4px; }
      .reader-gallery { display: flex; flex-wrap: wrap; gap: 8px; }
      .reader-gallery .reader-figure { flex: 1 1 200px; margin: 0; }
      .reader-gallery > figcaption { flex: 1 1 100%; font-size: 13px; opacity: 0.75; }

      .reader-table { border-collapse: collapse; width: 100%; font-size: 13px; }
      .reader-table th, .reader-table td {
        border: 1px solid rgba(0,0,0,0.15);
        padding: 4px 8px;
        text-align: left;
      }
      .reader-table caption { text-align: left; font-size: 13px; opacity: 0.75; margin-bottom: 4px; }
      .reader-code {
        font-family: var(--font-mono);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(0,0,0,0.04);
        border-radius: 8px;
        padding: 10px 12px;
      }
      .reader-media { opacity: 0.85; }
      .reader-archived { opacity: 0.75; font-style: italic; }

      @media print {
        .print-toolbar { display: none !important; }
        .print-doc { max-width: none; padding: 0; }
        @page { margin: 14mm; }
      }
`;

/**
 * Build the print handout for a presentation.
 *
 * @param {string} repoRoot - Repository root (CSS bundle and fork seam)
 * @param {object} pres - the presentation, already filtered for its context
 * @param {object} [opts]
 * @param {object|null} [opts.theme=null] - the deck theme, for fonts and vars
 * @param {object|null} [opts.watermark=null] - sandbox watermark settings
 * @param {Record<string, object>|null} [opts.slideTypes=null] - merged registry
 * @returns {Promise<string>} a complete HTML document
 */
export async function buildPrintHtml(
  repoRoot,
  pres,
  { theme = null, watermark = null, slideTypes = null } = {},
) {
  pres = stripLiveOnlySlidesFromPresentation(pres);
  const docLang = resolveDocLangFromPresentation(pres);
  const css = await loadExportCssBundle(repoRoot, theme, watermark);
  const registry =
    slideTypes && typeof slideTypes === 'object' ? slideTypes : SLIDE_TYPES;

  const rawTitle = pres.title || 'Presentation';
  const title = escapeHtml(rawTitle);
  const wmOn = css.wmOn;
  const wmText = wmOn ? escapeHtml(sandboxWatermarkText()) : '';
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  // A link that jumps to a slide points at that slide's section, by its place
  // in this document.
  const slideIds = slides.map((slide) =>
    typeof slide?.id === 'string' ? slide.id.trim() : '',
  );
  const slidesHtml = slides
    .map((slide, index) =>
      renderSlideSectionHtml(slide, getSlideType(slide?.type, registry), {
        index,
        lang: docLang,
        slideIds,
      }),
    )
    .join('\n');

  // Served as a `*-print.html` attachment by the public API as well as fed to
  // headless Chrome, and neither has an origin to resolve /client/vendor/
  // against — so the vendored copies travel inside the document.
  const highlightNeeds = detectPrismKatexNeeds(slidesHtml);

  return `${buildDocumentHead({
    lang: docLang,
    title: rawTitle,
    head: [buildPrismKatexTags({ ...highlightNeeds, mode: 'inlined' })],
    styles: [
      buildCssChain(
        repoRoot,
        [
          css.fontCss,
          stripFontFacesFromCss(css.chromeCss),
          css.themeVarsCss,
          css.themeCss,
          stripFontFacesFromCss(css.slidesCss),
          PRINT_DOC_CSS,
        ],
        { customCss: css.customCss },
      ),
    ],
  })}
  <body class="print-wrap ps-theme">
    <div class="print-toolbar">
      <div style="flex:1">${title}</div>
      ${wmText ? `<div class="print-watermark">${wmText}</div>` : ''}
      <button class="btn btn-primary" onclick="window.print()">Print / Save as PDF (text)</button>
    </div>
    <main class="print-doc">
      <h1 class="print-h1">${title}</h1>
      ${wmText ? `<div class="print-watermark" style="margin: 0 0 14px;">${wmText}</div>` : ''}
      ${slidesHtml}
    </main>
    ${buildScriptChain({ needs: highlightNeeds })}
  </body>
</html>`;
}
