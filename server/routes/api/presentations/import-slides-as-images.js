import { updatePresentation } from '../../../storage/presentations/index.js';
import {
  uploadImageKitBuffer,
  getImageKitConfigFromEnv,
} from '../../../media/imagekit.js';
import {
  getMediaProvider,
  isMediaProviderInitialized,
} from '../../../media/index.js';
import { pdfToImages } from '../../../render/pdf-to-images.js';
import { readPptxSlideNotes } from '../../../utils/convert-file/index.js';
import {
  methodNotAllowed,
  badRequest,
  requireJsonBody,
} from '../../../utils/http.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import { getString } from '../../../utils/request-validators.js';
import { createLogger } from '../../../utils/logger.js';
import { loadDeckTheme } from '../../../utils/themes.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { newSlide } from '../../../../shared/slide-types/presentation.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { insertAfterAnchor } from '../../../services/slides.js';
const log = createLogger('import-slides-as-images');

/**
 * Upload an image buffer using the best available method:
 * 1. ImageKit (if configured) - preferred for managed image hosting
 * 2. Media provider (S3/local) - fallback
 * @param {object} options
 * @param {Buffer} options.buffer - Image buffer
 * @param {string} options.fileName - File name
 * @param {string} options.mimeType - MIME type
 * @param {string[]} [options.tags] - Optional tags
 * @returns {Promise<string>} - Uploaded image URL
 */
async function uploadImageBuffer({ buffer, fileName, mimeType, tags = [] }) {
  // Try ImageKit first (consistent with existing PPTX import)
  const imagekitConfig = getImageKitConfigFromEnv();
  if (imagekitConfig.configured) {
    const result = await uploadImageKitBuffer({
      buffer,
      fileName,
      mimeType,
      tags,
    });
    return result?.url || '';
  }

  // Fall back to generic media provider (S3 or local)
  if (isMediaProviderInitialized()) {
    const provider = getMediaProvider();
    const result = await provider.uploadBuffer({
      buffer,
      filename: fileName,
      contentType: mimeType,
    });
    return result?.publicUrl || '';
  }

  throw new Error(
    'No media provider configured (neither ImageKit nor S3/local)',
  );
}

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
 * The speaker notes to put beside `pageCount` pages, by position, or null
 * when the counts do not match. A PDF exported from PowerPoint or Keynote
 * leaves hidden slides out by default, so the shown slides are tried first;
 * an export that kept them matches all slides.
 * @param {Array<{ hidden: boolean, notes: string }>} slides
 * @param {number} pageCount
 * @returns {string[]|null}
 */
function notesForPages(slides, pageCount) {
  const shown = slides.filter((s) => !s.hidden);
  if (shown.length === pageCount) return shown.map((s) => s.notes);
  if (slides.length === pageCount) return slides.map((s) => s.notes);
  return null;
}

/**
 * Handle POST /api/presentations/:id/import-slides-as-images
 *
 * Turns a deck into image slides, one per page, with the speaker notes of
 * each source slide as its notes (B700, D334). The pixels come from a PDF the
 * presentation app exported; the notes from the PowerPoint file beside it,
 * paired by slide order. Either file may come alone: a PDF gives images
 * without notes, a PowerPoint file gives notes on slides without an image.
 * When both come and the counts differ, nothing is imported. Streams
 * progress via SSE.
 *
 * Request body:
 * {
 *   dataUrl: "data:application/pdf;base64,...",        // the pixels
 *   filename: "talk.pdf",
 *   pptxDataUrl: "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,...", // the notes
 *   pptxFilename: "talk.pptx",
 *   insertAfterSlideId: "slide-abc" // optional, null = end of deck
 * }
 */
export async function handlePresentationImportSlidesAsImages(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({
    storageScope,
    id,
    authedUser,
    res,
    permission: 'write',
  });
  if (!pres) return true;

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const { filename, pptxFilename, insertAfterSlideId } = body || {};
  const dataUrl = getString(body, 'dataUrl');
  const pptxDataUrl = getString(body, 'pptxDataUrl');

  if (!dataUrl && !pptxDataUrl) {
    return badRequest(res, 'A PDF or a PowerPoint file is required');
  }
  const pdfBytes = dataUrl ? dataUrlFile(dataUrl, '%PDF-') : null;
  if (dataUrl && !pdfBytes) {
    return badRequest(res, 'dataUrl must be a PDF file');
  }
  const pptxBytes = pptxDataUrl ? dataUrlFile(pptxDataUrl, 'PK\x03\x04') : null;
  if (pptxDataUrl && !pptxBytes) {
    return badRequest(res, 'pptxDataUrl must be a PowerPoint (.pptx) file');
  }

  // Set up SSE
  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  // Cancelling is closing the stream: the signal stops the page renders, is
  // checked before every image upload, and before the deck is written.
  const { signal } = stream;

  const sendProgress = (message, data = {}) => {
    sseWrite(res, {
      event: 'progress',
      data: { message, ...data },
    });
  };

  const sendError = (message) => {
    sseError(res, message);
    res.end();
  };

  const sendComplete = (data) => {
    sseWrite(res, {
      event: 'complete',
      data,
    });
    res.end();
  };

  try {
    // The notes first: a PowerPoint file that cannot be read stops the import
    // before any page is rendered.
    let sourceSlides = null;
    if (pptxBytes) {
      try {
        sourceSlides = await readPptxSlideNotes(pptxBytes);
        // eslint-disable-next-line no-restricted-syntax -- an unreadable zip is the user's file, not a server fault: it gets a sentence, not a stack
      } catch {
        sourceSlides = [];
      }
      if (sourceSlides.length === 0) {
        sendError('No slides found in the PowerPoint file');
        return true;
      }
    }

    let images = null;
    if (pdfBytes) {
      sendProgress('Starting PDF conversion...', {
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
          sendProgress(`Rendering page ${page} of ${total}...`, {
            stage: 'converting',
            current: page,
            total,
          });
        },
      });
      if (!images || images.length === 0) {
        sendError('No pages found in PDF');
        return true;
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
          const shown = sourceSlides.filter((s) => !s.hidden).length;
          sendError(
            `The PDF has ${images.length} pages but the PowerPoint file has ${shown} slides. Export the PDF from the same presentation and try again.`,
          );
          return true;
        }
      }
    } else {
      notes = sourceSlides.filter((s) => !s.hidden).map((s) => s.notes);
      pages = notes.map((_, i) => ({ page: i + 1, buffer: null }));
    }

    if (images) {
      sendProgress(`Converted ${images.length} pages. Uploading images...`, {
        stage: 'uploading',
        current: 0,
        total: images.length,
      });
    }

    // Upload images to ImageKit and create slide objects
    const theme = await loadDeckTheme(repoRoot, pres.theme, storageScope);
    const slideTypes = await buildMergedSlideTypes(storageScope);
    const newSlides = [];
    const baseFilename = String(
      (images ? filename : pptxFilename) || 'imported',
    ).replace(/\.(pdf|pptx)$/i, '');

    for (let i = 0; i < pages.length; i++) {
      // Each iteration uploads a page to the media library — a write for
      // whoever asked. Checked before the upload, not after.
      signal.throwIfAborted();
      const img = pages[i];
      const pageNum = img.page;

      let imageUrl = '';
      if (img.buffer) {
        sendProgress(`Uploading page ${pageNum} of ${pages.length}...`, {
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
        lang: pres.lang,
        presentationId: id,
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

      newSlides.push(slide);
    }

    // The write step: the deck is not changed for a client that already left.
    signal.throwIfAborted();

    sendProgress('Updating presentation...', {
      stage: 'saving',
      current: pages.length,
      total: pages.length,
    });

    // Insert slides at the correct position: after the anchor, in its group
    // (D325), else at the end of the deck. Each slide anchors the next, so a
    // run after a child stays one run of sibling children.
    const existingSlides = Array.isArray(pres.slides) ? [...pres.slides] : [];
    const afterIdx = insertAfterSlideId
      ? existingSlides.findIndex((s) => s?.id === insertAfterSlideId)
      : -1;
    let insertIndex = existingSlides.length; // Default: end of deck
    if (afterIdx >= 0) {
      insertIndex = afterIdx + 1;
      let anchor = afterIdx;
      for (const slide of newSlides) {
        anchor = insertAfterAnchor(existingSlides, slide, anchor);
      }
    } else {
      existingSlides.push(...newSlides);
    }

    // Update the presentation
    const updated = await updatePresentation(
      storageScope,
      id,
      {
        ...pres,
        slides: existingSlides,
      },
      {
        actorEmail: authedUser?.email || null,
      },
    );

    sendComplete({
      success: true,
      slidesAdded: newSlides.length,
      withImages: Boolean(images),
      withNotes: Boolean(notes),
      insertedAt: insertIndex,
      slideIds: newSlides.map((s) => s.id),
      presentation: updated,
    });

    return true;
  } catch (err) {
    if (signal.aborted) {
      log.info('[import-slides] cancelled by the client');
      res.end();
      return true;
    }
    log.error('[import-slides] Error:', err?.message, err?.stack);
    sendError(err?.message || 'Failed to import slides');
    return true;
  }
}
