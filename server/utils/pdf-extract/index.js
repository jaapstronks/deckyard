/**
 * Read the structure of a slide PDF: one page model per page (B751).
 *
 * The import of an existing deck as editable slides (B737) needs more than
 * plain text or `pdfToImages()`'s pixels: it needs the lines
 * in reading order, which of them is the heading, a list, a table, and the
 * embedded pictures with their place on the page. pdf.js yields all of that
 * in Node, without a browser; this module turns it into one model, whichever
 * way the page was produced:
 *
 * - a tagged page (PowerPoint, Chrome) gets its roles from the structure
 *   tree (`struct-detector.js`);
 * - an untagged page (Keynote) gets them from size and position
 *   (`geometry-detector.js`), its lines in rows or, on request, column by
 *   column (`columns.js`).
 *
 * Both give the same shape, so a mapper downstream knows only the model.
 * The text is literal (see `lines.js`): what is not on the slide is listed
 * under `dropped` with a reason, never silently lost. Pure computation: no
 * uploads, no storage, no HTTP.
 */

import { openPdf } from './pdfjs.js';
import { readTextRuns, isOnPage } from './text-runs.js';
import { assembleLines } from './lines.js';
import { assembleColumnLines } from './columns.js';
import { detectStruct } from './struct-detector.js';
import { detectGeometry, findDrawingLabels } from './geometry-detector.js';
import { readPageGraphics } from './images.js';
import { readDocument } from './document.js';

export { assembleLines, joinLineText, normalizeText } from './lines.js';
export { isBoldFont } from './text-runs.js';
export {
  detectGeometry,
  findDrawingLabels,
  findHeadingLines,
  splitListMarker,
} from './geometry-detector.js';
export { detectStruct } from './struct-detector.js';
export { blockText, pageText } from './page-text.js';
export {
  documentFigures,
  furnitureKey,
  readDocument,
  renderDocument,
} from './document.js';

/** Text below this size (pt) under the running text is a footnote. */
export const FOOTNOTE_MAX_SIZE = 7;

/**
 * The bottom fraction of the page where small text is a footnote even when
 * no running text stands above it (B751). Small text higher up counts only
 * below the page's last line at body size (B772).
 */
export const FOOTNOTE_ZONE = 0.15;

/**
 * A reference mark is at most this fraction of the body size: the
 * superscript "1" or "45" a footnote is called with (B772).
 */
export const REFERENCE_MAX_RATIO = 0.8;

/** The digits of a reference mark, possibly several ("4,5", "4 5"). */
const REFERENCE_TEXT = /^\d{1,3}(?:[,\s]+\d{1,3})*$/;

/**
 * @typedef {object} PageLine
 * @property {string} text
 * @property {number} x
 * @property {number} y - baseline, from the top of the page
 * @property {number} width
 * @property {number} size - font size in page units (pt)
 * @property {boolean} bold - every run on the line is set in a bold font
 * @property {'heading'|'subheading'|'para'|'list-item'|'list-label'|'table-cell'|'caption'|'quote'|'card-title'|'card-body'|'label'} role
 */

/**
 * Blocks, in reading order; each carries `y`, the baseline of its first line.
 *
 * - `{ kind: 'para', text, bold, size, subheading? }` (`size`: the largest
 *   font size on its lines)
 * - `{ kind: 'list', variant: 'bullets'|'numbers', items: [{ text, parts }] }`
 *   (`parts`: the item's paragraphs; `text` is them joined)
 * - `{ kind: 'table', headerRow, rows: string[][] }`
 * - `{ kind: 'cards', cards: [{ title, body }] }`
 * - `{ kind: 'caption', text }`, `{ kind: 'quote', text }`
 *
 * @typedef {object} PageBlock
 */

/**
 * @typedef {object} PageModel
 * @property {number} page - 1-based
 * @property {number} width
 * @property {number} height
 * @property {boolean} tagged - roles come from the structure tree
 * @property {string | null} heading
 * @property {'struct' | 'geometry' | null} headingSource
 * @property {PageLine[]} lines - every kept line: heading, block text,
 *   list labels and drawing labels
 * @property {PageBlock[]} blocks
 * @property {Array<{ png: Buffer, box: { x: number, y: number, width: number, height: number }, pixels: { width: number, height: number }, alt?: string }>} images
 * @property {{ paths: number, labels: Array<{ text: string, x: number, y: number }> }} drawing
 * @property {DroppedLine[]} dropped
 */

/**
 * A line kept off the slide, with where it stood: the document reader
 * (`document.js`) takes a letter's heading block back out of the artifacts
 * by position.
 *
 * @typedef {object} DroppedLine
 * @property {string} text
 * @property {'artifact' | 'off-page' | 'footnote' | 'reference'} reason
 * @property {number} x
 * @property {number} y
 * @property {number} size
 * @property {Array<{ text: string, x: number }>} segments
 */

/**
 * Extract one page model per page.
 *
 * @param {Uint8Array} buffer - the PDF bytes
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal] - checked before the document opens and
 *   between pages; an abort rejects with the signal's reason
 * @param {boolean} [opts.useStructTree=true] - false reads every page by
 *   geometry, as if it were untagged (measurement, tests)
 * @param {boolean} [opts.columns=false] - read the text of an untagged page
 *   column by column (`columns.js`, B777): what the AI route wants, which
 *   reads running text. The slide import keeps rows: on a slide, boxes side
 *   by side are layout, and a box over a column would read as its text.
 * @returns {Promise<{ pages: PageModel[], tagged: boolean, pageCount: number, size: { width: number, height: number } | null, metadata: { title?: string, author?: string } }>}
 */
export async function extractPdfPages(
  buffer,
  { signal, useStructTree = true, columns = false } = {},
) {
  signal?.throwIfAborted();
  const task = openPdf(buffer);
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(n);
      try {
        pages.push(await readPage(page, n, { useStructTree, columns }));
      } finally {
        page.cleanup();
      }
    }
    signal?.throwIfAborted();
    return {
      pages,
      metadata: await readMetadata(doc),
      tagged: pages.some((p) => p.tagged),
      pageCount: doc.numPages,
      size: pages.length
        ? { width: pages[0].width, height: pages[0].height }
        : null,
    };
  } finally {
    await task.destroy();
  }
}

/**
 * Extract a PDF as one document: headings over the whole document, page
 * breaks and running furniture gone (B773, `document.js`).
 *
 * @param {Uint8Array} buffer - the PDF bytes
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ title: string | null, blocks: import('./document.js').DocumentBlock[], text: string }>}
 */
export async function extractPdfDocument(buffer, { signal } = {}) {
  return readDocument(await extractPdfPages(buffer, { signal, columns: true }));
}

/**
 * The text of every page as pdf.js lays it out, with no roles read: no
 * heading, no footnotes or artifacts taken out. What a test compares when it
 * asks whether an exported PDF still says the same thing (B776); the slide
 * import and the AI route read {@link extractPdfPages}.
 *
 * @param {Uint8Array} buffer - the PDF bytes
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<{ page: number, width: number, height: number, text: string }>>}
 */
export async function extractPdfText(buffer, { signal } = {}) {
  signal?.throwIfAborted();
  const task = openPdf(buffer);
  try {
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(n);
      try {
        const { width, height } = page.getViewport({ scale: 1 });
        const { items } = await page.getTextContent();
        const text = items
          .map((item) => item.str + (item.hasEOL ? '\n' : ''))
          .join('');
        pages.push({ page: n, width, height, text });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function readPage(page, n, { useStructTree, columns }) {
  const viewport = page.getViewport({ scale: 1 });
  const box = { width: viewport.width, height: viewport.height };
  // Fonts are only loaded (and their names readable) after the operator list.
  const operatorList = await page.getOperatorList();
  const textContent = await page.getTextContent({ includeMarkedContent: true });
  const runs = readTextRuns(textContent, {
    viewport,
    fontNameOf: (id) => fontName(page, id),
  });
  const graphics = await readPageGraphics(page, operatorList, viewport);
  const tree = useStructTree ? await page.getStructTree() : null;

  const { body, dropped } = dropNonSlideText(runs, box);
  let detected = tree ? detectStruct(tree, body, box) : null;
  const tagged = Boolean(detected);
  if (!detected) detected = detectByGeometry(body, box, graphics, { columns });

  return {
    page: n,
    width: box.width,
    height: box.height,
    tagged,
    heading: detected.heading,
    headingSource: detected.headingSource,
    lines: detected.lines.map(publicLine),
    blocks: detected.blocks,
    images: attachAlt(graphics.images, detected.figures),
    drawing: {
      paths: graphics.paths,
      labels: detected.labels.map(({ text, x, y }) => ({ text, x, y })),
    },
    dropped,
  };
}

/** Title and author from the document info, where the producer set them. */
async function readMetadata(doc) {
  const { info } = await doc.getMetadata().catch(() => ({}));
  const metadata = {};
  if (info?.Title) metadata.title = String(info.Title);
  if (info?.Author) metadata.author = String(info.Author);
  return metadata;
}

function fontName(page, id) {
  try {
    return page.commonObjs.has(id) ? page.commonObjs.get(id)?.name || '' : '';
  } catch {
    return '';
  }
}

/**
 * Split off what does not belong on the slide: `Artifact` content (footer,
 * page number), runs outside the page box, footnotes and the reference marks
 * that call them. The rest is the body the detectors read.
 *
 * A footnote is small text (below {@link FOOTNOTE_MAX_SIZE}) anywhere in
 * the bottom {@link FOOTNOTE_ZONE}, or higher up when it is also smaller
 * than the body, under the page's last line at body size and aligned with
 * the body's left edge and worded, on a page whose text carries reference
 * marks (a chart label below the text is no footnote). A reference mark is a short number set clearly
 * smaller than the body, raised just above a body line.
 */
function dropNonSlideText(runs, box) {
  const dropped = [];
  const drop = (line, reason) => dropped.push(droppedLine(line, reason));
  const note = (selected, reason) => {
    for (const line of assembleLines(selected)) drop(line, reason);
  };
  note(
    runs.filter((r) => r.artifact),
    'artifact',
  );
  const inFlow = runs.filter((r) => !r.artifact);
  note(
    inFlow.filter((r) => !isOnPage(r, box)),
    'off-page',
  );
  const onPage = inFlow.filter((r) => isOnPage(r, box));
  const lines = assembleLines(onPage);
  const bodySize = dominantSize(onPage);
  const bodyLines = lines.filter((l) => l.size >= bodySize);
  const lastBodyY = Math.max(-Infinity, ...bodyLines.map((l) => l.y));
  const bodyLeft = Math.min(Infinity, ...bodyLines.map((l) => l.x));
  const references = lines.filter(
    (l) =>
      isReferenceMark(l, bodySize) &&
      bodyLines.some((b) => raisedAbove(l, b, bodySize)),
  );
  const inZone = (l) => l.y > (1 - FOOTNOTE_ZONE) * box.height;
  // Above the zone a footnote needs a mark in the text that calls it, and
  // words; a bare number there counts only as the mark beside one. So the
  // labels of a chart under the text stay.
  const underText = references.length
    ? lines.filter(
        (l) =>
          !inZone(l) &&
          l.size < bodySize &&
          l.y > lastBodyY &&
          Math.abs(l.x - bodyLeft) <= 2 * bodySize,
      )
    : [];
  const worded = underText.filter((l) => /\p{L}/u.test(l.text));
  const footnotes = lines.filter(
    (l) =>
      l.size < FOOTNOTE_MAX_SIZE &&
      (inZone(l) ||
        worded.includes(l) ||
        (underText.includes(l) &&
          worded.some((w) => Math.abs(w.y - l.y) <= bodySize))),
  );
  for (const line of footnotes) drop(line, 'footnote');
  for (const line of references)
    if (!footnotes.includes(line)) drop(line, 'reference');
  const droppedRuns = new Set(
    [...footnotes, ...references].flatMap((l) => l.runs),
  );
  return { body: onPage.filter((r) => !droppedRuns.has(r)), dropped };
}

function droppedLine({ text, x, y, size, segments }, reason) {
  return {
    text,
    reason,
    x,
    y,
    size,
    segments: segments.map((seg) => ({ text: seg.text, x: seg.x })),
  };
}

/** The font size that carries the most characters: the page's body size. */
function dominantSize(runs) {
  const chars = new Map();
  for (const r of runs) {
    const size = Math.round(r.size * 10) / 10;
    chars.set(size, (chars.get(size) || 0) + r.str.trim().length);
  }
  let best = 0;
  let bestChars = 0;
  for (const [size, count] of chars) {
    if (count > bestChars || (count === bestChars && size > best)) {
      best = size;
      bestChars = count;
    }
  }
  return best;
}

function isReferenceMark(line, bodySize) {
  return (
    line.size <= REFERENCE_MAX_RATIO * bodySize &&
    REFERENCE_TEXT.test(line.text)
  );
}

/**
 * The mark sits within the body line's width, its baseline less than an em
 * above the body baseline: the place of a superscript.
 */
function raisedAbove(mark, line, bodySize) {
  const rise = line.y - mark.y;
  return (
    rise > 0 &&
    rise < bodySize &&
    mark.x >= line.x - bodySize &&
    mark.x <= line.x + line.width + bodySize
  );
}

function detectByGeometry(runs, box, graphics, { columns }) {
  const lines = columns ? assembleColumnLines(runs) : assembleLines(runs);
  const labels = findDrawingLabels(lines, {
    paths: graphics.paths,
    boxes: graphics.pathBoxes,
  });
  const result = detectGeometry(lines, box, { exclude: labels });
  return {
    heading: result.heading,
    headingSource: result.heading ? 'geometry' : null,
    lines: lines.map((line, i) => ({ ...line, role: result.roles[i] })),
    blocks: result.blocks,
    labels: [...labels].map((i) => lines[i]),
    figures: [],
  };
}

function publicLine({ text, x, y, width, size, bold, role }) {
  return { text, x, y, width, size, bold, role };
}

const mcNumber = (id) => {
  const match = /_mc(\d+)$/.exec(String(id));
  return match ? Number(match[1]) : null;
};

/**
 * Give each image the `alt` of the `Figure` it is painted in, matched by
 * marked-content id; a page with one figure and one image pairs them.
 */
function attachAlt(images, figures) {
  const withAlt = figures.filter((f) => f.alt);
  const altOf = (img) => {
    const hit = withAlt.find((f) =>
      f.ids.some((id) => mcNumber(id) === img.mcid),
    );
    if (hit) return hit.alt;
    if (withAlt.length === 1 && images.length === 1) return withAlt[0].alt;
    return null;
  };
  return images.map((img) => {
    const alt = altOf(img);
    const out = { png: img.png, box: img.box, pixels: img.pixels };
    if (alt) out.alt = alt;
    return out;
  });
}
