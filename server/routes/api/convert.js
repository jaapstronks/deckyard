/**
 * API route for converting PowerPoint/PDF files to presentations.
 */

import { updatePresentation } from '../../storage/presentations/index.js';
import {
  assertCreatableDeckInput,
  createPresentation,
} from '../../services/presentations.js';
import {
  badRequest,
  jsonError,
  serveJson,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import { getConvertParams } from '../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../shared/slide-types.js';
import { settleNewDeckTheme } from '../../utils/themes.js';
import { createLogger } from '../../utils/logger.js';
import { sseWrite, sseError, openSseStream } from '../../utils/sse.js';
import { clientDisconnectSignal } from '../../utils/client-disconnect.js';
import { dispatchRoutes } from '../../utils/router.js';
const log = createLogger('convert');
import {
  convertFile,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
} from '../../utils/convert-file/index.js';
import { DEFAULT_DECK_LANG } from '../../../shared/i18n-utils.js';
import {
  OUTLINE_CREEP_MS,
  PROGRESS,
  REFINE_CREEP_MS,
} from '../../utils/import-progress.js';

// POST /api/convert - Convert a file to a presentation
async function handleConvertFile({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before the conversion, so a refused body costs no work (B576).
  assertCreatableDeckInput(body);
  const { dataUrl, filename, vendor, lang, theme } = getConvertParams(body);

  if (!dataUrl) {
    return badRequest(res, 'Expected { dataUrl: "data:..." }');
  }
  if (!filename) {
    return badRequest(res, 'Expected { filename: "..." }');
  }
  // Checked before the conversion, so an unknown theme costs no work.
  const { themeId, theme: themeConfig } = await settleNewDeckTheme(
    repoRoot,
    theme,
    storageScope,
  );

  // Parse the data URL
  const dataUrlMatch = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!dataUrlMatch) {
    return badRequest(res, 'Invalid data URL format');
  }

  const mimeType = dataUrlMatch[1];
  const base64Data = dataUrlMatch[2];

  // Validate file type
  const ext = filename.toLowerCase().split('.').pop();
  if (
    !SUPPORTED_EXTENSIONS.includes(ext) &&
    !SUPPORTED_MIME_TYPES.includes(mimeType)
  ) {
    return badRequest(
      res,
      `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }

  // Decode the file
  let buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch (e) {
    return badRequest(res, 'Failed to decode file data');
  }

  // Check file size (max 50MB for conversion)
  const maxBytes = 50 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return badRequest(res, 'File too large (max 50MB)');
  }

  // Cancelling is dropping the request: the signal aborts the model calls
  // and the image uploads, and is checked before the presentation is written.
  const signal = clientDisconnectSignal(res);

  // Convert the file
  let converted;
  try {
    converted = await convertFile(buffer, {
      filename,
      mimeType,
      lang,
      vendor,
      signal,
    });
  } catch (e) {
    if (!signal.aborted) throw e;
    log.info('[Convert] cancelled by the client');
    return true;
  }
  const { deck, report } = converted;

  if (!deck || report.errors.length > 0) {
    // Conversion failed
    jsonError(
      res,
      422,
      'conversion_failed',
      report.errors.join('; ') || 'Conversion failed',
      { details: { report } },
    );
    return true;
  }

  // Create the presentation from the deck
  try {
    const parts = deckToPresentationParts(deck, {
      theme: themeConfig,
      lang: deck.lang || deck._generationMeta?.effectiveLang || lang,
    });

    // Use the detected/effective language from the deck, not the original request
    const effectiveLang =
      deck.lang || deck._generationMeta?.effectiveLang || DEFAULT_DECK_LANG;

    // The write step: no deck is created for a client that already left.
    if (signal.aborted) {
      log.info('[Convert] cancelled by the client');
      return true;
    }

    const created = await createPresentation(
      storageScope,
      { actor: authedUser },
      {
        title: parts.title || deck.title || 'Converted Presentation',
        theme: themeId,
        lang: effectiveLang,
      },
    );

    const updated = await updatePresentation(
      storageScope,
      created.id,
      {
        ...created,
        title: parts.title || deck.title || 'Converted Presentation',
        slides: parts.slides,
        settings: deck.settings || {
          stepParagraphs: true,
          transitions: { preset: 'fade' },
        },
      },
      { actorEmail: authedUser?.email || null },
    );

    serveJson(res, 201, {
      success: true,
      presentation: updated,
      report,
      detectedLang: effectiveLang, // Include detected language for client navigation
    });
  } catch {
    jsonError(
      res,
      500,
      'presentation_create_failed',
      'Failed to create presentation',
    );
  }

  return true;
}

// POST /api/convert/stream - Convert a file, streaming progress over SSE
async function handleConvertStream({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before the conversion, so a refused body costs no work (B576).
  assertCreatableDeckInput(body);
  const { dataUrl, filename, vendor, lang, theme } = getConvertParams(body);

  if (!dataUrl) {
    return badRequest(res, 'Expected { dataUrl: "data:..." }');
  }
  if (!filename) {
    return badRequest(res, 'Expected { filename: "..." }');
  }
  // Checked before the conversion, so an unknown theme costs no work.
  const { themeId, theme: themeConfig } = await settleNewDeckTheme(
    repoRoot,
    theme,
    storageScope,
  );

  // Parse the data URL
  const dataUrlMatch = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!dataUrlMatch) {
    return badRequest(res, 'Invalid data URL format');
  }

  const mimeType = dataUrlMatch[1];
  const base64Data = dataUrlMatch[2];

  // Validate file type
  const ext = filename.toLowerCase().split('.').pop();
  if (
    !SUPPORTED_EXTENSIONS.includes(ext) &&
    !SUPPORTED_MIME_TYPES.includes(mimeType)
  ) {
    return badRequest(
      res,
      `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
    );
  }

  // Decode the file
  let buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch (e) {
    return badRequest(res, 'Failed to decode file data');
  }

  // Check file size
  const maxBytes = 50 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return badRequest(res, 'File too large (max 50MB)');
  }

  // Set up SSE headers
  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  // Cancelling is closing the stream: the signal aborts the model calls and
  // the image uploads, and is checked before the presentation is written.
  const { signal } = stream;

  // Determine file type for contextual messages
  const isPptx =
    ext === 'pptx' || ext === 'ppt' || mimeType.includes('presentation');
  const isPdf = ext === 'pdf' || mimeType === 'application/pdf';
  const isDocument =
    ext === 'docx' ||
    ext === 'rtf' ||
    ext === 'odt' ||
    mimeType.includes('wordprocessingml') ||
    mimeType.includes('opendocument.text') ||
    mimeType === 'application/rtf' ||
    mimeType === 'text/rtf';
  // For initial messages, use Dutch (default UI) - actual content language is auto-detected
  const isNl = true;

  // Initial status messages shown in sequence (file parsing phase)
  const initialMessages = isPptx
    ? isNl
      ? [
          'PowerPoint-bestand laden...',
          'Slides analyseren...',
          'Tekst extraheren...',
          'Afbeeldingen zoeken...',
        ]
      : [
          'Loading PowerPoint file...',
          'Analyzing slides...',
          'Extracting text content...',
          'Looking for images...',
        ]
    : isPdf
      ? isNl
        ? [
            'PDF-bestand laden...',
            "Pagina's analyseren...",
            'Tekst extraheren...',
            'Afbeeldingen detecteren...',
          ]
        : [
            'Loading PDF file...',
            'Analyzing pages...',
            'Extracting text content...',
            'Detecting images...',
          ]
      : isDocument
        ? isNl
          ? [
              'Document laden...',
              'Tekst extraheren...',
              'Structuur analyseren...',
              'Secties identificeren...',
            ]
          : [
              'Loading document...',
              'Extracting text...',
              'Analyzing structure...',
              'Identifying sections...',
            ]
        : isNl
          ? ['Bestand laden...', 'Inhoud extraheren...']
          : ['Loading file...', 'Extracting content...'];

  try {
    // The parse messages are handed to the client's rotator instead of being
    // paced here with sleeps: parsing and the outline call start immediately,
    // and the rotator fills the wait. Sleeping on the server only made the
    // import longer (B595).
    signal.throwIfAborted();
    sseWrite(res, {
      event: 'messages',
      data: { statusMessages: initialMessages, intervalMs: 6000, loop: true },
    });
    sseWrite(res, {
      event: 'status',
      data: {
        message: initialMessages[0],
        phase: 'parse',
        progress: PROGRESS.parse,
      },
    });

    // Parsing plus the outline call is one long stretch without events, so the
    // bar creeps toward the refine floor instead of standing still.
    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl
          ? 'Inhoud analyseren en structuur bepalen...'
          : 'Analyzing content and structure...',
        phase: 'analyze',
        progress: PROGRESS.parse,
        creepTo: PROGRESS.refineFloor,
        creepMs: OUTLINE_CREEP_MS,
      },
    });

    // Convert with streaming status callback
    // The convertFile function will call onStatusMessage as it generates content-aware messages
    const statusMessages = [];
    let statusMessagesSent = false;

    const { deck, report } = await convertFile(buffer, {
      filename,
      mimeType,
      lang,
      vendor,
      enableLogging: true,
      signal,
      onStatusMessage: (msg) => {
        statusMessages.push(msg);
        // Message only: the bar is owned by the creep until the first section
        // group finishes, so an arriving message may not move it.
        if (!statusMessagesSent) {
          sseWrite(res, {
            event: 'status',
            data: { message: msg, phase: 'convert' },
          });
        }
      },
      onOutlineComplete: (outline) => {
        // When outline is ready, send all status messages at once for client rotation
        if (outline?.statusMessages?.length > 0) {
          statusMessagesSent = true;
          sseWrite(res, {
            event: 'messages',
            data: {
              statusMessages: outline.statusMessages,
            },
          });
          // The outline is a real milestone, so the bar lands on the refine
          // floor; from there the phase creeps until a group reports.
          sseWrite(res, {
            event: 'status',
            data: {
              phase: 'refine',
              progress: PROGRESS.refineFloor,
              creepTo: PROGRESS.refineCeiling,
              creepMs: REFINE_CREEP_MS,
            },
          });
        }
      },
      // Real progress: one event per finished section group, the same shape
      // the wizard stream uses.
      onGroupDone: ({ done, total }) => {
        sseWrite(res, {
          event: 'status',
          data: {
            message: isNl
              ? `Sectie ${done} van ${total} geschreven…`
              : `Wrote section ${done} of ${total}…`,
            progress: Math.round(
              PROGRESS.refineFloor +
                (done / total) *
                  (PROGRESS.refineCeiling - PROGRESS.refineFloor),
            ),
            phase: 'refine-progress',
          },
        });
      },
    });

    // If no messages were streamed during conversion, send what we have
    if (statusMessages.length > 0 && !statusMessagesSent) {
      sseWrite(res, { event: 'messages', data: { statusMessages } });
    }

    if (!deck || report.errors.length > 0) {
      sseError(res, report.errors.join('; ') || 'Conversion failed', {
        report,
      });
      res.end();
      return true;
    }

    // Post-conversion messages
    const slideCount = deck?.slides?.length || 0;
    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl
          ? `${slideCount} slide${slideCount !== 1 ? 's' : ''} gegenereerd`
          : `Generated ${slideCount} slide${slideCount !== 1 ? 's' : ''}`,
        progress: PROGRESS.refineCeiling,
        phase: 'finalize',
      },
    });
    await new Promise((r) => setTimeout(r, 500));

    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl ? 'Presentatie opbouwen...' : 'Building presentation...',
        progress: PROGRESS.building,
        phase: 'finalize',
      },
    });
    await new Promise((r) => setTimeout(r, 500));

    // Create presentation
    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl ? 'Opslaan in bibliotheek...' : 'Saving to library...',
        progress: PROGRESS.save,
        phase: 'save',
      },
    });

    const parts = deckToPresentationParts(deck, {
      theme: themeConfig,
      lang: deck.lang || deck._generationMeta?.effectiveLang || lang,
    });

    // Use the detected/effective language from the deck, not the original request
    const effectiveLang =
      deck.lang || deck._generationMeta?.effectiveLang || DEFAULT_DECK_LANG;

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();

    const created = await createPresentation(
      storageScope,
      { actor: authedUser },
      {
        title: parts.title || deck.title || 'Converted Presentation',
        theme: themeId,
        lang: effectiveLang,
      },
    );

    const updated = await updatePresentation(
      storageScope,
      created.id,
      {
        ...created,
        title: parts.title || deck.title || 'Converted Presentation',
        slides: parts.slides,
        settings: deck.settings || {
          stepParagraphs: true,
          transitions: { preset: 'fade' },
        },
      },
      { actorEmail: authedUser?.email || null },
    );

    sseWrite(res, {
      event: 'complete',
      data: {
        presentation: updated,
        report,
        detectedLang: effectiveLang, // Include detected language for client navigation
      },
    });
  } catch (e) {
    if (signal.aborted) {
      log.info('[Convert Stream] cancelled by the client');
    } else {
      log.error('[Convert Stream] Error:', e);
      sseError(res, e.message || 'Conversion failed');
    }
  }

  res.end();
  return true;
}

// GET /api/convert/status - Check if conversion is available
function handleConvertStatus({ res }) {
  serveJson(res, 200, {
    available: true,
    supportedFormats: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: SUPPORTED_MIME_TYPES,
  });
  return true;
}

/**
 * Declarative route table for `/api/convert*` (A7.19 C8). Order matches the
 * previous if-chain; all three are exact paths that fall through on a method
 * mismatch (the chain had no 405).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'POST', pattern: '/api/convert', handler: handleConvertFile },
  {
    method: 'POST',
    pattern: '/api/convert/stream',
    handler: handleConvertStream,
  },
  {
    method: 'GET',
    pattern: '/api/convert/status',
    handler: handleConvertStatus,
  },
];

/**
 * Handle /api/convert routes.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleConvert = withErrorHandler('convert', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
