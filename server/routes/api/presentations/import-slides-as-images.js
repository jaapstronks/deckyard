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
 * Handle POST /api/presentations/:id/import-slides-as-images
 *
 * Accepts a PDF file (as dataUrl) and converts each page to an image slide.
 * Streams progress via SSE.
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

  if (!dataUrl.startsWith('data:application/pdf')) {
    return badRequest(res, 'Only PDF files are supported');
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
    sendProgress('Starting PDF conversion...', {
      stage: 'converting',
      current: 0,
      total: 0,
    });

    // Convert PDF to images
    const images = await pdfToImages({
      dataUrl,
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

    sendProgress(`Converted ${images.length} pages. Uploading images...`, {
      stage: 'uploading',
      current: 0,
      total: images.length,
    });

    // Upload images to ImageKit and create slide objects
    const theme = await loadDeckTheme(repoRoot, pres.theme, storageScope);
    const slideTypes = await buildMergedSlideTypes(storageScope);
    const newSlides = [];
    const baseFilename = (filename || 'imported').replace(/\.pdf$/i, '');

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
          alt: `${baseFilename} - Page ${pageNum}`,
          bleed: true,
        },
      });

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
    sendError(err?.message || 'Failed to import PDF');
    return true;
  }
}
