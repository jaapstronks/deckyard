/**
 * POST /api/presentations/import/images
 *
 * Creates a new deck from an existing one as image slides (B306): one
 * image-slide per page of a PDF the presentation app exported, with the
 * speaker notes of the PowerPoint file beside it. The "import an existing
 * deck" route of the creation view, next to `/api/convert/stream`, which
 * generates a new deck from source material. The route is the endpoint: a
 * request here never lands in the AI interpretation, and it needs no AI.
 *
 * Reading the files and building the slides is
 * `services/deck-images-import.js`, shared with the editor's insert route
 * (`/api/presentations/:id/import-slides-as-images`). Streams progress via
 * SSE; the `complete` event carries the new deck.
 *
 * Request body:
 * {
 *   dataUrl: "data:application/pdf;base64,...",   // the pixels
 *   filename: "talk.pdf",
 *   pptxDataUrl: "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,...", // the notes
 *   pptxFilename: "talk.pptx",
 *   lang: "nl",
 *   theme: "<theme id>"                         // optional, settled like every create
 * }
 */

import { assertCreatableDeckInput } from '../../../services/presentations.js';
import { createImportedPresentation } from '../../../services/import-json.js';
import {
  buildDeckImageSlides,
  deckImageBaseName,
  DeckImagesRefusal,
  readDeckImageFiles,
} from '../../../services/deck-images-import.js';
import { badRequest, requireJsonBody } from '../../../utils/http.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import { settleNewDeckTheme } from '../../../utils/themes.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { createLogger } from '../../../utils/logger.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';
const log = createLogger('import-images');

export async function handlePresentationsImportImages({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
} = {}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before any page is rendered, so a refused body costs no work.
  assertCreatableDeckInput(body);
  const read = readDeckImageFiles(body);
  if (!read.ok) return badRequest(res, read.message);

  const lang = normalizeLang(body?.lang) || DEFAULT_DECK_LANG;
  // Checked before the render, so an unknown theme costs no work (B486).
  const { themeId, theme } = await settleNewDeckTheme(
    repoRoot,
    body?.theme,
    storageScope,
  );

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  // Cancelling is closing the stream: the signal stops the page renders, is
  // checked before every image upload, and before the deck is created.
  const { signal } = stream;

  try {
    const slideTypes = await buildMergedSlideTypes(storageScope);
    const { slides, withImages, withNotes } = await buildDeckImageSlides({
      files: read.files,
      theme,
      lang,
      slideTypes,
      signal,
      onProgress: (message, data = {}) =>
        sseWrite(res, { event: 'progress', data: { message, ...data } }),
    });

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();
    sseWrite(res, {
      event: 'progress',
      data: {
        message: 'Creating presentation...',
        stage: 'saving',
        current: slides.length,
        total: slides.length,
      },
    });

    const presentation = await createImportedPresentation(
      storageScope,
      { actor: authedUser },
      {
        parts: { title: deckImageBaseName(read.files), slides },
        slideTypes,
        lang,
        theme: themeId,
      },
    );

    sseWrite(res, {
      event: 'complete',
      data: {
        presentation,
        slidesAdded: slides.length,
        withImages,
        withNotes,
      },
    });
  } catch (err) {
    if (signal.aborted) {
      log.info('[import-images] cancelled by the client');
    } else if (err instanceof DeckImagesRefusal) {
      sseError(res, err.message);
    } else {
      log.error('[import-images] Error:', err?.message, err?.stack);
      sseError(res, 'Failed to import the deck');
    }
  }

  res.end();
  return true;
}
