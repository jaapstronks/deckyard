import { getPresentation, updatePresentation } from '../../../storage/presentations.js';
import { uploadImageKitBuffer, getImageKitConfigFromEnv } from '../../../media/imagekit.js';
import { getMediaProvider, isMediaProviderInitialized } from '../../../media/index.js';
import { pdfToImages } from '../../../render/pdf-to-images.js';
import {
  json,
  methodNotAllowed,
  notFound,
  serveJson,
} from '../../../utils/http.js';
import { sseWrite } from '../../../utils/sse.js';
import { canWritePresentation } from '../../../utils/presentation-authz.js';

/**
 * Upload an image buffer using the best available method:
 * 1. ImageKit (if configured) - preferred for managed image hosting
 * 2. Media provider (Scaleway/local) - fallback
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

  // Fall back to generic media provider (Scaleway or local)
  if (isMediaProviderInitialized()) {
    const provider = getMediaProvider();
    const result = await provider.uploadBuffer({
      buffer,
      filename: fileName,
      contentType: mimeType,
    });
    return result?.publicUrl || '';
  }

  throw new Error('No media provider configured (neither ImageKit nor Scaleway/local)');
}

function generateSlideId() {
  return `slide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
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
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);
  if (!canWritePresentation({ user: authedUser, pres })) {
    return serveJson(res, 403, { error: 'Not authorized' });
  }

  const body = await json(req);
  const { dataUrl, filename, insertAfterSlideId } = body || {};

  if (!dataUrl || typeof dataUrl !== 'string') {
    return serveJson(res, 400, { error: 'dataUrl is required' });
  }

  if (!dataUrl.startsWith('data:application/pdf')) {
    return serveJson(res, 400, { error: 'Only PDF files are supported' });
  }

  // Set up SSE
  writeSseHeaders(res);

  const sendProgress = (message, data = {}) => {
    sseWrite(res, {
      event: 'progress',
      data: { message, ...data },
    });
  };

  const sendError = (message) => {
    sseWrite(res, {
      event: 'error',
      data: { error: message },
    });
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
    sendProgress('Starting PDF conversion...', { stage: 'converting', current: 0, total: 0 });

    // Convert PDF to images
    const images = await pdfToImages({
      dataUrl,
      width: 1920,
      height: 1080,
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
    const newSlides = [];
    const baseFilename = (filename || 'imported').replace(/\.pdf$/i, '');

    for (let i = 0; i < images.length; i++) {
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
        console.error(`[import-slides] Failed to upload page ${pageNum}:`, uploadErr?.message);
        // Continue with empty URL - user can add image later
      }

      // Create image-slide object (fields must be inside content object)
      const slide = {
        id: generateSlideId(),
        type: 'image-slide',
        content: {
          image: imageUrl,
          alt: `${baseFilename} - Page ${pageNum}`,
          title: '',
          subheading: '',
          bottomSubheading: '',
          imageRole: 'content',
          caption: '',
          focusX: '',
          focusY: '',
          layout: 'bleed',
          zoomSteps: '',
          zoomLevel: 2,
          zoomPositions: '',
        },
        notes: '',
      };

      newSlides.push(slide);
    }

    sendProgress('Updating presentation...', {
      stage: 'saving',
      current: images.length,
      total: images.length,
    });

    // Insert slides at the correct position
    const existingSlides = Array.isArray(pres.slides) ? [...pres.slides] : [];
    let insertIndex = existingSlides.length; // Default: end of deck

    if (insertAfterSlideId) {
      const afterIdx = existingSlides.findIndex((s) => s?.id === insertAfterSlideId);
      if (afterIdx >= 0) {
        insertIndex = afterIdx + 1;
      }
    }

    // Insert the new slides
    existingSlides.splice(insertIndex, 0, ...newSlides);

    // Update the presentation
    const updated = await updatePresentation(repoRoot, id, {
      ...pres,
      slides: existingSlides,
    }, {
      actorEmail: authedUser?.email || null,
    });

    sendComplete({
      success: true,
      slidesAdded: newSlides.length,
      insertedAt: insertIndex,
      slideIds: newSlides.map((s) => s.id),
      presentation: updated,
    });

    return true;
  } catch (err) {
    console.error('[import-slides] Error:', err?.message, err?.stack);
    sendError(err?.message || 'Failed to import PDF');
    return true;
  }
}