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
import {
  pptxToPdf,
  isPptxRasterAvailable,
} from '../../../render/pptx-to-pdf.js';
import { readPptxSlideNotes } from '../../../utils/convert-file/index.js';
import {
  methodNotAllowed,
  badRequest,
  jsonError,
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
 * What an uploaded file is, by its bytes rather than the label the browser
 * gave it: `'pdf'`, `'pptx'` (a zip; whether it holds a deck is checked when
 * its slides are read), or null.
 * @param {Buffer} buffer
 * @returns {'pdf'|'pptx'|null}
 */
function rasterSourceKind(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer.subarray(0, 4).toString('latin1') === 'PK\x03\x04') return 'pptx';
  return null;
}

/** The bytes of a base64 data URL, or null when it is not one. */
function dataUrlBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  if (!dataUrl.slice(0, comma).endsWith(';base64')) return null;
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

/**
 * Handle POST /api/presentations/:id/import-slides-as-images
 *
 * Accepts a PDF or a PowerPoint file (as dataUrl) and turns each page or
 * shown slide into an image slide. A PowerPoint file brings its speaker notes
 * along as the notes of each image slide (B700); it needs LibreOffice on the
 * server (`pptxRasterImport` in the feature snapshot). Streams progress via
 * SSE.
 *
 * Request body:
 * {
 *   dataUrl: "data:application/pdf;base64,...",
 *   filename: "source.pdf",
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
  const { filename, insertAfterSlideId } = body || {};
  const dataUrl = getString(body, 'dataUrl');

  if (!dataUrl) {
    return badRequest(res, 'dataUrl is required');
  }

  const fileBytes = dataUrlBytes(dataUrl);
  const kind = fileBytes ? rasterSourceKind(fileBytes) : null;
  if (!kind) {
    return badRequest(res, 'Only PDF and PowerPoint files are supported');
  }
  if (kind === 'pptx' && !isPptxRasterAvailable()) {
    return jsonError(
      res,
      400,
      'pptx_import_unavailable',
      'This server cannot import PowerPoint files as images',
    );
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
    // A PowerPoint file is read for its notes, then printed to a PDF; from
    // there both kinds take the same route. LibreOffice leaves hidden slides
    // out of the PDF, so the notes of the shown slides line up with its pages.
    let pdfBytes = fileBytes;
    let shownNotes = null;
    if (kind === 'pptx') {
      sendProgress('Converting the presentation...', {
        stage: 'converting',
        current: 0,
        total: 0,
      });
      const slides = await readPptxSlideNotes(fileBytes);
      if (slides.length === 0) {
        sendError('No slides found in this file');
        return true;
      }
      shownNotes = slides.filter((s) => !s.hidden).map((s) => s.notes);
      pdfBytes = await pptxToPdf({ buffer: fileBytes, signal });
    } else {
      sendProgress('Starting PDF conversion...', {
        stage: 'converting',
        current: 0,
        total: 0,
      });
    }

    const images = await pdfToImages({
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

    // Notes go by position, so only when every page has its slide: a count
    // that does not match would put notes beside the wrong image.
    if (shownNotes && shownNotes.length !== images.length) {
      log.warn(
        `[import-slides] ${shownNotes.length} shown slides but ${images.length} pages; importing without notes`,
      );
      shownNotes = null;
    }

    sendProgress(`Converted ${images.length} pages. Uploading images...`, {
      stage: 'uploading',
      current: 0,
      total: images.length,
    });

    // Upload images to ImageKit and create slide objects
    const theme = await loadDeckTheme(repoRoot, pres.theme, storageScope);
    const slideTypes = await buildMergedSlideTypes(storageScope);
    const newSlides = [];
    const baseFilename = String(filename || 'imported').replace(
      /\.(pdf|pptx)$/i,
      '',
    );
    const unit = kind === 'pptx' ? 'slide' : 'page';

    for (let i = 0; i < images.length; i++) {
      // Each iteration uploads a page to the media library — a write for
      // whoever asked. Checked before the upload, not after.
      signal.throwIfAborted();
      const img = images[i];
      const pageNum = img.page;

      sendProgress(`Uploading page ${pageNum} of ${images.length}...`, {
        stage: 'uploading',
        current: pageNum,
        total: images.length,
      });

      // Upload image using best available method (ImageKit or media provider)
      let imageUrl = '';
      try {
        imageUrl = await uploadImageBuffer({
          buffer: img.buffer,
          fileName: `${baseFilename}-${unit}-${String(pageNum).padStart(3, '0')}.png`,
          mimeType: 'image/png',
          tags: [`${kind}-import`, `source:${baseFilename}`],
        });
      } catch (uploadErr) {
        log.error(
          `[import-slides] Failed to upload page ${pageNum}:`,
          uploadErr?.message,
        );
        // Continue with empty URL - user can add image later
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
          alt: `${baseFilename} - ${unit === 'slide' ? 'Slide' : 'Page'} ${pageNum}`,
          bleed: true,
        },
      });
      // Speaker notes stay plain text: they are read from the upload, and
      // the notes field is where the presenter reads them back.
      if (shownNotes) slide.notes = shownNotes[i] || '';

      newSlides.push(slide);
    }

    // The write step: the deck is not changed for a client that already left.
    signal.throwIfAborted();

    sendProgress('Updating presentation...', {
      stage: 'saving',
      current: images.length,
      total: images.length,
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
    sendError(err?.message || 'Failed to import the file');
    return true;
  }
}
