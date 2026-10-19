/**
 * PDF → source text for the AI route (B772, B773).
 *
 * Reads through `pdf-extract`, the reader the slide import uses, so both
 * tracks agree on what the running text is: footnotes, the reference marks
 * that call them, page furniture and text off the page stay out.
 *
 * A PDF comes in one of two shapes (B773), told apart by the page form:
 *
 * - **slides**: mostly landscape pages with little text each. One page stays
 *   one "slide" of text, a list item keeps a `- ` in front.
 * - **document**: everything else. The whole PDF is read as one document
 *   (`readDocument()`): headings over the document as `#`, paragraphs
 *   joined over page breaks, tables as pipe tables, running headers and
 *   footers gone. It travels as `document`, marked-up text the generation
 *   pipeline reads as it is.
 *
 * In the slide shape, artifact text (what a tagged PDF marks as page
 * furniture) is dropped, with one exception: on the first page, artifact
 * text that recurs on no other page goes along. In the document shape the
 * document reader keeps only a letter's heading block of it ("Betreft …",
 * the date).
 *
 * The pictures that are content (`documentFigures()`: no icons, logos or
 * backgrounds) are marked in the text as `[IMAGE n: …]` (B775): where they
 * stand in a document, at the end of their page in the slide shape. Their
 * pixels come back as `figures`; nothing is uploaded here.
 */

import {
  documentFigures,
  extractPdfPages,
  furnitureKey,
  pageText,
  readDocument,
} from '../pdf-extract/index.js';
import { sourceImageMarker } from '../ai/source-images.js';

/** A PDF whose median page holds less text than this can be a deck. */
export const SLIDE_MAX_CHARS = 1200;

/**
 * @param {Buffer | Uint8Array} buffer - the PDF bytes
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{shape: 'slides' | 'document' | null, slides: Array<{slideNumber: number, textContent: string}>, document?: string, figures: import('../pdf-extract/document.js').DocumentFigure[], metadata: object, errors: string[]}>}
 *   `slides` holds the text per page in both shapes; `document` only in
 *   the document shape.
 */
export async function readPdf(buffer, { signal } = {}) {
  let result;
  try {
    result = await extractPdfPages(new Uint8Array(buffer), { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      shape: null,
      slides: [],
      figures: [],
      metadata: {},
      errors: [`Error parsing PDF: ${e.message}`],
    };
  }

  const heading = firstPageHeading(result.pages);
  const figures = documentFigures(result.pages).map(
    ({ box, ...figure }) => figure,
  );
  const slides = result.pages
    .map((page, i) => ({
      slideNumber: page.page,
      textContent: [
        i === 0 ? heading : '',
        pageText(page, { listMarkers: true }),
        ...figures.filter((f) => f.page === page.page).map(figureMarker),
      ]
        .filter(Boolean)
        .join('\n'),
    }))
    .filter((slide) => slide.textContent.trim());

  const errors = slides.length
    ? []
    : [
        'Could not extract any text from the PDF. It may be image-based or protected.',
      ];
  const shape = pdfShape(result.pages);
  const out = { shape, slides, figures, metadata: result.metadata, errors };
  if (shape === 'document' && slides.length) {
    out.document = readDocument(result, { imageMarker: figureMarker }).text;
  }
  return out;
}

/** The `[IMAGE n: …]` marker of a figure. */
const figureMarker = (figure) =>
  sourceImageMarker({
    n: figure.n,
    caption: figure.alt,
    page: figure.page,
    pixels: figure.pixels,
  });

/**
 * Slides when most pages are landscape and the median page holds little
 * text; otherwise a document.
 * @param {import('../pdf-extract/index.js').PageModel[]} pages
 * @returns {'slides' | 'document'}
 */
export function pdfShape(pages) {
  if (!pages.length) return 'document';
  const landscape = pages.filter((p) => p.width > p.height).length;
  const chars = pages.map((p) => pageText(p).length).sort((a, b) => a - b);
  const median = chars[Math.floor(chars.length / 2)];
  return landscape * 2 > pages.length && median < SLIDE_MAX_CHARS
    ? 'slides'
    : 'document';
}

/**
 * The artifact lines of the first page that recur on no other page.
 * @param {import('../pdf-extract/index.js').PageModel[]} pages
 * @returns {string}
 */
function firstPageHeading(pages) {
  const [first, ...rest] = pages;
  if (!first) return '';
  const artifacts = (page) =>
    page.dropped.filter((d) => d.reason === 'artifact').map((d) => d.text);
  const recurring = new Set(rest.flatMap(artifacts).map(furnitureKey));
  return artifacts(first)
    .filter((text) => !recurring.has(furnitureKey(text)))
    .join('\n');
}
