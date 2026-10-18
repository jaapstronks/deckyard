/**
 * PDF → source text for the AI route (B772).
 *
 * Reads through `pdf-extract`, the reader the slide import uses, so both
 * tracks agree on what the running text is: footnotes, the reference marks
 * that call them, page furniture and text off the page stay out. One page
 * stays one "slide" of text here, a list item keeps a `- ` in front; the
 * document shape (headings, tables, page breaks) is B773's.
 *
 * Artifact text (what a tagged PDF marks as page furniture) is dropped, with
 * one exception: on the first page, artifact text that recurs on no other
 * page goes along. That is a letter's heading block ("Betreft …", the
 * date): the subject of the document, not furniture.
 */

import { extractPdfPages, pageText } from '../pdf-extract/index.js';

/**
 * @param {Buffer | Uint8Array} buffer - the PDF bytes
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{slides: Array<{slideNumber: number, textContent: string}>, metadata: object, errors: string[]}>}
 */
export async function readPdf(buffer, { signal } = {}) {
  let result;
  try {
    result = await extractPdfPages(new Uint8Array(buffer), { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      slides: [],
      metadata: {},
      errors: [`Error parsing PDF: ${e.message}`],
    };
  }

  const heading = firstPageHeading(result.pages);
  const slides = result.pages
    .map((page, i) => ({
      slideNumber: page.page,
      textContent: [
        i === 0 ? heading : '',
        pageText(page, { listMarkers: true }),
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
  return { slides, metadata: result.metadata, errors };
}

/** A page number or date differs per page; the furniture around it does not. */
const furnitureKey = (text) => text.replace(/\d+/g, '#');

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
