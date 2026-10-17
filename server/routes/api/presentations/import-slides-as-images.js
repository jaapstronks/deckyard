import { updatePresentation } from '../../../storage/presentations/index.js';
import {
  methodNotAllowed,
  badRequest,
  requireJsonBody,
} from '../../../utils/http.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import { createLogger } from '../../../utils/logger.js';
import { loadDeckTheme } from '../../../utils/themes.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { insertAfterAnchor } from '../../../services/slides.js';
import {
  buildDeckImageSlides,
  DeckImagesRefusal,
  readDeckImageFiles,
} from '../../../services/deck-images-import.js';
const log = createLogger('import-slides-as-images');

/**
 * Handle POST /api/presentations/:id/import-slides-as-images
 *
 * Inserts a deck as image slides, one per page, with the speaker notes of
 * each source slide as its notes (B700, D334). Reading the files and building
 * the slides is `services/deck-images-import.js`, shared with the route that
 * creates a new deck from them (`import/images`). Streams progress via SSE.
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
  const { insertAfterSlideId } = body || {};
  const read = readDeckImageFiles(body);
  if (!read.ok) return badRequest(res, read.message);

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
    const theme = await loadDeckTheme(repoRoot, pres.theme, storageScope);
    const slideTypes = await buildMergedSlideTypes(storageScope);
    const {
      slides: newSlides,
      withImages,
      withNotes,
    } = await buildDeckImageSlides({
      files: read.files,
      theme,
      lang: pres.lang,
      presentationId: id,
      slideTypes,
      signal,
      onProgress: sendProgress,
    });

    // The write step: the deck is not changed for a client that already left.
    signal.throwIfAborted();

    sendProgress('Updating presentation...', {
      stage: 'saving',
      current: newSlides.length,
      total: newSlides.length,
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
      withImages,
      withNotes,
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
    if (err instanceof DeckImagesRefusal) {
      sendError(err.message);
      return true;
    }
    log.error('[import-slides] Error:', err?.message, err?.stack);
    sendError(err?.message || 'Failed to import slides');
    return true;
  }
}
