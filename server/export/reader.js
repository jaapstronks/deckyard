/**
 * Semantic reflowable HTML export ("reader" view).
 *
 * A separate, accessible projection of a presentation: real heading hierarchy
 * (one <h1>, an <h2> per slide), landmarks (<header>/<nav>/<main>), a
 * navigable table of contents, figures with alt text, and reflow-friendly CSS
 * (WCAG 1.4.10) — fully readable with JavaScript AND author CSS off. The canvas
 * export (server/export/html.js) is untouched and remains the presentation view.
 *
 * Per-slide content is projected generically from the field vocabulary via
 * shared/slide-types/semantic-projection.js, so every slide type is covered
 * without bespoke code and the output can't drift from the type definitions.
 */

import {
  getSlideType,
  SLIDE_TYPES,
} from '../../shared/slide-types/registry.js';
import {
  slideHeading,
  renderSlideSectionHtml,
} from '../../shared/slide-types/semantic-projection.js';
import { filterForExport, filterForPublished } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { escapeHtml } from '../utils/html-utils.js';
import { buildCssChain } from '../utils/css-chain.js';
import { buildDocumentHead } from '../utils/head-chain.js';

// Self-contained, reflow-first stylesheet. Relative units + a single readable
// column; no fixed canvas dimensions, no absolute positioning. Degrades to
// plain readable flow when disabled entirely.
//
// This is the whole of the *reader chain* — the second of Deckyard's two CSS
// chains (docs/reference/fork-setup.md § Two chains, one seam). The canvas
// chain stacks core + theme + per-path document CSS; this one is a single
// layer, because the reader shares no vocabulary with it: 51 `.reader-*`
// selectors, no `.slide`, no `--t-*`, and a contract test that forbids the
// canvas idiom outright (tests/semantic-reader.test.js). What the two chains do
// share is where they end — `buildCssChain` appends `custom/styles/` last to
// both, so a fork can restyle the reader without patching this file.
const READER_DOC_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  color: #14181f;
  background: #fff;
}
.reader-header, .reader-toc, .reader-main, .reader-footer {
  max-width: 44rem;
  margin-inline: auto;
  padding-inline: 1.25rem;
}
.reader-header { padding-block: 2rem 0.5rem; }
.reader-kicker {
  font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase;
  opacity: 0.6; margin: 0 0 0.25rem;
}
.reader-header h1 { font-size: clamp(1.6rem, 4vw, 2.4rem); line-height: 1.15; margin: 0 0 0.5rem; }
.reader-desc { font-size: 1.05rem; opacity: 0.85; margin: 0.25rem 0 0.75rem; }
.reader-viewlink { font-size: 0.9rem; }
.reader-toc { padding-block: 0.75rem 0.5rem; }
.reader-toc h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.6; margin: 0 0 0.4rem; }
.reader-toc ol { margin: 0; padding-left: 1.4rem; }
.reader-toc li { margin: 0.15rem 0; }
.reader-main { padding-block: 1rem 2rem; counter-reset: reader-slide; }
.reader-slide { padding-block: 1.25rem; border-top: 1px solid rgba(0,0,0,0.1); counter-increment: reader-slide; }
.reader-slide:first-child { border-top: 0; }
.reader-slide h2 { font-size: clamp(1.25rem, 3vw, 1.6rem); line-height: 1.2; margin: 0 0 0.6rem; scroll-margin-top: 1rem; }
.reader-slide > h2::before {
  content: counter(reader-slide) ". ";
  content: counter(reader-slide) ". " / "";
  font-variant-numeric: tabular-nums; opacity: 0.5; font-size: 0.85em;
}
/* Hidden headings stay in flow: a 1px box pulled back by its own margin, so the
   reader keeps its no-absolute-positioning contract. Scoped under the section
   so it outranks the .reader-slide h2 margin above. */
.reader-slide .reader-sr-only {
  width: 1px; height: 1px; margin: -1px 0 0; padding: 0; border: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
.reader-slide h3 { font-size: 1.05rem; margin: 1rem 0 0.35rem; }
.reader-slide p { margin: 0.5rem 0; }
.reader-slide ul, .reader-slide ol { margin: 0.5rem 0; padding-left: 1.4rem; }
.reader-slide blockquote {
  margin: 0.75rem 0; padding: 0.25rem 0 0.25rem 0.9rem;
  border-left: 3px solid rgba(0,0,0,0.2); opacity: 0.9;
}
.reader-summary { opacity: 0.85; font-style: italic; }
.reader-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; }
.reader-label dfn { font-style: normal; }
.reader-caption { font-size: 0.9rem; opacity: 0.75; }
.reader-slide footer { font-size: 0.9rem; opacity: 0.8; }
.reader-slide footer p { margin: 0.15rem 0; }
.reader-slide blockquote p { margin: 0.25rem 0; }
.reader-slide aside {
  margin: 0.75rem 0; padding: 0.4rem 0.9rem;
  border: 1px solid rgba(0,0,0,0.15); border-radius: 6px;
}
.reader-slide aside .reader-label { margin: 0 0 0.2rem; }
ul.reader-items { list-style: none; padding-left: 0; }
ol.reader-items { list-style: decimal; padding-left: 1.5rem; }
.reader-item { margin: 0.75rem 0; padding-left: 0.9rem; border-left: 3px solid rgba(0,0,0,0.12); }
.reader-figure { margin: 0.75rem 0; }
.reader-figure img { max-width: 100%; height: auto; border-radius: 6px; }
.reader-figure figcaption { font-size: 0.9rem; opacity: 0.75; margin-top: 0.3rem; }
.reader-gallery { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.reader-gallery .reader-figure { flex: 1 1 12rem; margin: 0; }
.reader-gallery > figcaption { flex: 1 1 100%; font-size: 0.9rem; opacity: 0.75; }
.reader-table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
.reader-table th, .reader-table td { border: 1px solid rgba(0,0,0,0.15); padding: 0.35rem 0.5rem; text-align: left; }
.reader-table caption { display: block; text-align: left; font-size: 0.9rem; opacity: 0.75; margin-bottom: 0.3rem; }
.reader-media { margin: 0.75rem 0; font-size: 0.95rem; opacity: 0.85; }
.reader-code { overflow-x: auto; background: rgba(0,0,0,0.05); padding: 0.6rem 0.75rem; border-radius: 6px; }
.reader-archived { opacity: 0.75; font-style: italic; }
.reader-fields { margin: 0.75rem 0; }
.reader-field { margin: 0.6rem 0; padding-left: 0.9rem; border-left: 3px solid rgba(0,0,0,0.12); }
.reader-field dt { font-weight: 600; font-size: 0.9rem; opacity: 0.75; }
.reader-field dd { margin: 0.15rem 0 0; }
.reader-footer { padding-block: 1.5rem 3rem; font-size: 0.85rem; opacity: 0.7; }
a { color: #0b57d0; }
img { max-width: 100%; height: auto; }
@media (prefers-color-scheme: dark) {
  body { color: #e7ebf2; background: #14181f; }
  .reader-slide { border-color: rgba(255,255,255,0.12); }
  .reader-item { border-left-color: rgba(255,255,255,0.16); }
  .reader-field { border-left-color: rgba(255,255,255,0.16); }
  .reader-slide blockquote { border-left-color: rgba(255,255,255,0.24); }
  .reader-table th, .reader-table td { border-color: rgba(255,255,255,0.2); }
  .reader-code { background: rgba(255,255,255,0.08); }
  a { color: #8ab4ff; }
}
`.trim();

/**
 * Build the semantic reflowable HTML document for a presentation.
 *
 * @param {string} repoRoot - Repository root; the fork CSS seam is read from
 *   `custom/styles/` under it (server/utils/css-chain.js)
 * @param {object} pres
 * @param {object} [opts]
 * @param {'export'|'published'} [opts.context='export'] - visibility filter
 * @param {Record<string, object>|null} [opts.slideTypes=null] - merged registry
 * @param {string} [opts.canonicalUrl=''] - link to the canvas presentation view
 * @param {string} [opts.headHtml=''] - extra <head> markup (canonical/robots/OG)
 * @returns {string} a complete HTML document
 */
export function buildReaderHtml(
  repoRoot,
  pres,
  {
    context = 'export',
    slideTypes = null,
    canonicalUrl = '',
    headHtml = '',
  } = {},
) {
  const filtered =
    context === 'published' ? filterForPublished(pres) : filterForExport(pres);
  const registry =
    slideTypes && typeof slideTypes === 'object' ? slideTypes : SLIDE_TYPES;
  const docLang = resolveDocLangFromPresentation(filtered);

  const title = str(filtered?.title) || 'Presentation';
  const description = str(filtered?.description);
  const slides = Array.isArray(filtered?.slides) ? filtered.slides : [];

  const resolved = slides.map((slide) => ({
    slide,
    def: getSlideType(slide?.type, registry),
  }));

  // The contents list names every slide by its section heading, hidden or not:
  // a hidden heading is still the name a reader navigates by.
  const toc = resolved
    .map(
      ({ slide, def }, i) =>
        `<li><a href="#slide-${i + 1}">${escapeHtml(slideHeading(slide, def, { index: i, lang: docLang }).text)}</a></li>`,
    )
    .join('\n        ');

  // A slide whose type no longer resolves gets the archived-slide projection:
  // the reader is the *complete* surface of that contract (no canvas size
  // limit), so it is where an author recovers content the placeholder slide
  // had to truncate.
  // A link that jumps to a slide points at that slide's section, by its place
  // in this document (hidden slides are already filtered out).
  const slideIds = slides.map((slide) => str(slide?.id));
  const sections = resolved
    .map(({ slide, def }, i) =>
      renderSlideSectionHtml(slide, def, {
        index: i,
        lang: docLang,
        slideIds,
      }),
    )
    .join('\n      ');

  const viewLink = canonicalUrl
    ? `<p class="reader-viewlink"><a href="${escapeHtml(canonicalUrl)}">View the slides</a></p>`
    : '';
  const descHtml = description
    ? `<p class="reader-desc">${escapeHtml(description)}</p>`
    : '';

  return `${buildDocumentHead({
    lang: docLang,
    title,
    description,
    head: [headHtml],
    styles: [buildCssChain(repoRoot, [READER_DOC_CSS])],
  })}
  <body>
    <header class="reader-header">
      <p class="reader-kicker">Presentation</p>
      <h1>${escapeHtml(title)}</h1>
      ${descHtml}
      ${viewLink}
    </header>
    <nav class="reader-toc" aria-label="Slides">
      <h2>Contents</h2>
      <ol>
        ${toc}
      </ol>
    </nav>
    <main class="reader-main">
      ${sections}
    </main>
    <footer class="reader-footer">
      <p>${slides.length} slide${slides.length === 1 ? '' : 's'}.</p>
    </footer>
  </body>
</html>`;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}
