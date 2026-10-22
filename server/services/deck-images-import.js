/**
 * Import an existing deck as image slides (pad B; B700, D334, B306).
 *
 * One image-slide per page of a PDF the presentation app exported, with the
 * speaker notes of the PowerPoint file beside it, paired by slide order.
 * Either file may come alone: a PDF gives images without notes, a PowerPoint
 * file gives notes on slides without an image. The one implementation behind
 * both routes that take a deck as pictures: inserting into an open deck
 * (`POST /api/presentations/:id/import-slides-as-images`) and creating a new
 * one (`POST /api/presentations/import/images`). The routes keep HTTP, the
 * stream and the write; this module reads the files and builds the slides.
 */

import { uploadImageBuffer } from '../media/upload-buffer.js';
import { pdfToImages } from '../render/pdf-to-images.js';
import { readPptxSlideNotes } from '../utils/convert-file/index.js';
import { getString } from '../utils/request-validators.js';
import { createLogger } from '../utils/logger.js';
import { newSlide } from '../../shared/slide-types/presentation.js';
const log = createLogger('deck-images-import');

/**
 * A refusal of the user's files, found while reading them: the route sends
 * its message as the stream's `error` event. Anything else is a server fault.
 */
export class DeckImagesRefusal extends Error {}

/**
 * The bytes of a base64 data URL when they start with `magic`, else null.
 * The file is recognized by its bytes, not by the label the browser gave it.
 * @param {string} dataUrl
 * @param {string} magic - `%PDF-` for a PDF, `PK\x03\x04` for a zip (PPTX)
 * @returns {Buffer|null}
 */
function dataUrlFile(dataUrl, magic) {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  if (!dataUrl.slice(0, comma).endsWith(';base64')) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  return bytes.subarray(0, magic.length).toString('latin1') === magic
    ? bytes
    : null;
}

/**
 * The deck files of a request body, checked by their bytes before any stream
 * opens: `{ dataUrl, filename }` is the PDF (the pixels), `{ pptxDataUrl,
 * pptxFilename }` the PowerPoint file (the notes).
 * @param {object} body
 * @returns {{ ok: true, files: DeckImageFiles } | { ok: false, message: string }}
 */
export function readDeckImageFiles(body) {
  const dataUrl = getString(body, 'dataUrl');
  const pptxDataUrl = getString(body, 'pptxDataUrl');
  if (!dataUrl && !pptxDataUrl) {
    return { ok: false, message: 'A PDF or a PowerPoint file is required' };
  }
  const pdfBytes = dataUrl ? dataUrlFile(dataUrl, '%PDF-') : null;
  if (dataUrl && !pdfBytes) {
    return { ok: false, message: 'dataUrl must be a PDF file' };
  }
  const pptxBytes = pptxDataUrl ? dataUrlFile(pptxDataUrl, 'PK\x03\x04') : null;
  if (pptxDataUrl && !pptxBytes) {
    return {
      ok: false,
      message: 'pptxDataUrl must be a PowerPoint (.pptx) file',
    };
  }
  return {
    ok: true,
    files: {
      pdfBytes,
      pptxBytes,
      filename: getString(body, 'filename'),
      pptxFilename: getString(body, 'pptxFilename'),
    },
  };
}

/**
 * @typedef {object} DeckImageFiles
 * @property {Buffer|null} pdfBytes
 * @property {Buffer|null} pptxBytes
 * @property {string} filename - The PDF's name.
 * @property {string} pptxFilename - The PowerPoint file's name.
 */

/**
 * The name the files share, without the extension: the base of every
 * uploaded page and alt text, and the title of a deck created from them.
 * @param {DeckImageFiles} files
 * @returns {string}
 */
export function deckImageBaseName(files) {
  return String(
    (files.pdfBytes ? files.filename : files.pptxFilename) || 'imported',
  ).replace(/\.(pdf|pptx)$/i, '');
}

/**
 * The slides of a PowerPoint file with their speaker notes, in deck order.
 * @param {Buffer} pptxBytes
 * @returns {Promise<Array<{ hidden: boolean, notes: string }>>}
 * @throws {DeckImagesRefusal} the file is no readable deck or holds no slides.
 */
export async function readSourceSlides(pptxBytes) {
  let slides;
  try {
    slides = await readPptxSlideNotes(pptxBytes);
    // eslint-disable-next-line no-restricted-syntax -- an unreadable zip is the user's file, not a server fault: it gets a sentence, not a stack
  } catch {
    slides = [];
  }
  if (slides.length === 0) {
    throw new DeckImagesRefusal('No slides found in the PowerPoint file');
  }
  return slides;
}

/**
 * The refusal for a PDF and a PowerPoint file that do not pair.
 * @param {number} pageCount - the pages of the PDF
 * @param {number} shown - the slides of the PowerPoint file a PDF export
 *   shows (hidden slides left out)
 * @returns {DeckImagesRefusal}
 */
export function countMismatch(pageCount, shown) {
  return new DeckImagesRefusal(
    `The PDF has ${pageCount} pages but the PowerPoint file has ${shown} slides. Export the PDF from the same presentation and try again.`,
  );
}

/**
 * The speaker notes to put beside `pageCount` pages, by position, or null
 * when the counts do not match. A PDF exported from PowerPoint or Keynote
 * leaves hidden slides out by default, so the shown slides are tried first;
 * an export that kept them matches all slides.
 * @param {Array<{ hidden: boolean, notes: string }>} slides
 * @param {number} pageCount
 * @returns {string[]|null}
 */
export function notesForPages(slides, pageCount) {
  const shown = slides.filter((s) => !s.hidden);
  if (shown.length === pageCount) return shown.map((s) => s.notes);
  if (slides.length === pageCount) return slides.map((s) => s.notes);
  return null;
}

/**
 * Build one image-slide per page. When both files come and their counts
 * differ, nothing is built.
 *
 * @param {object} opts
 * @param {DeckImageFiles} opts.files - From {@link readDeckImageFiles}.
 * @param {object} opts.theme - The target deck's resolved theme.
 * @param {string} opts.lang - The target deck's language.
 * @param {string} [opts.presentationId] - The target deck, when it exists.
 * @param {Record<string, object>} opts.slideTypes - The organization's map.
 * @param {AbortSignal} opts.signal - Stops the page renders, checked before
 *   every upload.
 * @param {(message: string, data: object) => void} opts.onProgress
 * @returns {Promise<{ slides: object[], withImages: boolean, withNotes: boolean }>}
 * @throws {DeckImagesRefusal} the files hold no slides or pages, or their
 *   counts differ.
 */
export async function buildDeckImageSlides({
  files,
  theme,
  lang,
  presentationId = '',
  slideTypes,
  signal,
  onProgress,
}) {
  const { pdfBytes, pptxBytes } = files;

  // The notes first: a PowerPoint file that cannot be read stops the import
  // before any page is rendered.
  const sourceSlides = pptxBytes ? await readSourceSlides(pptxBytes) : null;

  let images = null;
  if (pdfBytes) {
    onProgress('Starting PDF conversion...', {
      stage: 'converting',
      current: 0,
      total: 0,
    });
    images = await pdfToImages({
      buffer: pdfBytes,
      width: 1920,
      height: 1080,
      signal,
      onProgress: (page, total) => {
        onProgress(`Rendering page ${page} of ${total}...`, {
          stage: 'converting',
          current: page,
          total,
        });
      },
    });
    if (!images || images.length === 0) {
      throw new DeckImagesRefusal('No pages found in PDF');
    }
  }

  // One entry per slide to create: a rendered page, or, from a PowerPoint
  // file alone, a shown slide without an image.
  let pages;
  let notes = null;
  if (images) {
    pages = images;
    if (sourceSlides) {
      notes = notesForPages(sourceSlides, images.length);
      if (!notes) {
        throw countMismatch(
          images.length,
          sourceSlides.filter((s) => !s.hidden).length,
        );
      }
    }
  } else {
    notes = sourceSlides.filter((s) => !s.hidden).map((s) => s.notes);
    pages = notes.map((_, i) => ({ page: i + 1, buffer: null }));
  }

  if (images) {
    onProgress(`Converted ${images.length} pages. Uploading images...`, {
      stage: 'uploading',
      current: 0,
      total: images.length,
    });
  }

  const baseFilename = deckImageBaseName(files);
  const slides = [];
  for (let i = 0; i < pages.length; i++) {
    // Each iteration uploads a page to the media library — a write for
    // whoever asked. Checked before the upload, not after.
    signal.throwIfAborted();
    const img = pages[i];
    const pageNum = img.page;

    let imageUrl = '';
    if (img.buffer) {
      onProgress(`Uploading page ${pageNum} of ${pages.length}...`, {
        stage: 'uploading',
        current: pageNum,
        total: pages.length,
      });

      // Upload image using best available method (ImageKit or media provider)
      try {
        imageUrl = await uploadImageBuffer({
          buffer: img.buffer,
          fileName: `${baseFilename}-page-${String(pageNum).padStart(3, '0')}.png`,
          mimeType: 'image/png',
          tags: ['pdf-import', `source:${baseFilename}`],
        });
      } catch (uploadErr) {
        log.error(
          `[import-slides] Failed to upload page ${pageNum}:`,
          uploadErr?.message,
        );
        // Continue with empty URL - user can add image later
      }
    }

    // One page, one image-slide: the image as a patch over the type's
    // defaults, edge to edge (`bleed`; the default fit is already cover).
    const slide = newSlide({
      type: 'image-slide',
      theme,
      lang,
      presentationId,
      slideTypes,
      content: {
        image: imageUrl,
        alt: img.buffer ? `${baseFilename} - Page ${pageNum}` : '',
        bleed: true,
      },
    });
    // Speaker notes stay plain text: they are read from the upload, and the
    // notes field is where the presenter reads them back.
    if (notes) slide.notes = notes[i] || '';

    slides.push(slide);
  }

  return { slides, withImages: Boolean(images), withNotes: Boolean(notes) };
}
