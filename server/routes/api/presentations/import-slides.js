/**
 * POST /api/presentations/import/slides
 *
 * Creates a new deck from an existing one as editable slides (B752, track 1a
 * of B737; B829): one slide per page, of the type the page's structure asks
 * for, with the page's text letter for letter. The structure is read from
 * the PowerPoint file when it comes (with its speaker notes), else from the
 * PDF the presentation app exported. A page that fits no type becomes an
 * image of itself rendered from the PDF, with its text in the notes; without
 * a PDF it keeps its text on a text slide. The report names those pages, a
 * reason for each, and the source the pages were read from.
 *
 * The sibling of `import/images` (every page as a picture): the same body,
 * the same refusals of the files, its own endpoint, because the route is the
 * endpoint (D235): no `mode` field switches a request between the two. No AI.
 * Reading the PDF and building the slides is `services/deck-slides-import.js`.
 * Streams progress via SSE; the `complete` event carries the new deck and the
 * report.
 *
 * Request body:
 * {
 *   dataUrl: "data:application/pdf;base64,...",   // the pages' pixels (and their structure without a .pptx)
 *   filename: "talk.pdf",
 *   pptxDataUrl: "data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,...", // the structure and the notes
 *   pptxFilename: "talk.pptx",
 *   lang: "nl",
 *   theme: "<theme id>"                         // optional, settled like every create
 * }
 * At least one of `dataUrl` and `pptxDataUrl`.
 */

import { assertCreatableDeckInput } from '../../../services/presentations.js';
import { createImportedPresentation } from '../../../services/import-json.js';
import {
  deckImageBaseName,
  DeckImagesRefusal,
  readDeckImageFiles,
} from '../../../services/deck-images-import.js';
import { buildDeckSlides } from '../../../services/deck-slides-import.js';
import { badRequest, requireJsonBody } from '../../../utils/http.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import { settleNewDeckTheme } from '../../../utils/themes.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { createLogger } from '../../../utils/logger.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';
const log = createLogger('import-slides');

export async function handlePresentationsImportSlides({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
  renderPages,
} = {}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before the PDF is read, so a refused body costs no work.
  assertCreatableDeckInput(body);
  const read = readDeckImageFiles(body);
  if (!read.ok) return badRequest(res, read.message);

  const lang = normalizeLang(body?.lang) || DEFAULT_DECK_LANG;
  // Checked before the work, so an unknown theme costs nothing (B486).
  const { themeId, theme } = await settleNewDeckTheme(
    repoRoot,
    body?.theme,
    storageScope,
  );

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  // Cancelling is closing the stream: the signal stops the reading and the
  // page renders, is checked before every image upload, and before the deck
  // is created.
  const { signal } = stream;

  try {
    const slideTypes = await buildMergedSlideTypes(storageScope);
    const { slides, report } = await buildDeckSlides({
      files: read.files,
      theme,
      lang,
      slideTypes,
      signal,
      // The page rasteriser; tests pass one so no browser starts.
      ...(renderPages ? { renderPages } : {}),
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

    sseWrite(res, { event: 'complete', data: { presentation, report } });
  } catch (err) {
    if (signal.aborted) {
      log.info('[import-slides] cancelled by the client');
    } else if (err instanceof DeckImagesRefusal) {
      sseError(res, err.message);
    } else {
      log.error('[import-slides] Error:', err?.message, err?.stack);
      sseError(res, 'Failed to import the deck');
    }
  }

  res.end();
  return true;
}
