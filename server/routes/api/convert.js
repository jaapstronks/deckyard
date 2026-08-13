/**
 * API route for converting PowerPoint/PDF files to presentations.
 */

import {
  createPresentation,
  updatePresentation,
} from '../../storage/presentations/index.js';
import {
  badRequest,
  jsonError,
  serveJson,
  requireJsonBody,
} from '../../utils/http.js';
import {
  getConvertParams,
} from '../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../shared/slide-types.js';
import { createLogger } from '../../utils/logger.js';
import { sseErrorPayload, openSseStream } from '../../utils/sse.js';
import { dispatchRoutes } from '../../utils/router.js';
const log = createLogger('convert');
import {
  convertFile,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
} from '../../utils/convert-file/index.js';


// POST /api/convert - Convert a file to a presentation
async function handleConvertFile({ storageScope, req, res, authedUser }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const { dataUrl, filename, vendor, lang, theme } = getConvertParams(body);

  if (!dataUrl) {
    return badRequest(
      res,
      'Expected { dataUrl: "data:..." }'
    );
  }
  if (!filename) {
    return badRequest(
      res,
      'Expected { filename: "..." }'
    );
  }

  // Parse the data URL
  const dataUrlMatch = dataUrl.match(
    /^data:([^;]+);base64,(.*)$/
  );
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
      `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(
        ', '
      )}`
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

  // Convert the file
  const { deck, report } = await convertFile(buffer, {
    filename,
    mimeType,
    lang,
    vendor,
  });

  if (!deck || report.errors.length > 0) {
    // Conversion failed
    jsonError(
      res,
      422,
      'conversion_failed',
      report.errors.join('; ') || 'Conversion failed',
      { details: { report } }
    );
    return true;
  }

  // Create the presentation from the deck
  try {
    const parts = deckToPresentationParts(deck);

    // Use the detected/effective language from the deck, not the original request
    const effectiveLang =
      deck.lang ||
      deck._generationMeta?.effectiveLang ||
      'nl';

    const created = await createPresentation(storageScope, {
      title:
        parts.title ||
        deck.title ||
        'Converted Presentation',
      theme: theme,
      ownerEmail: authedUser?.email || null,
      lang: effectiveLang,
    });

    const updated = await updatePresentation(storageScope,
      created.id,
      {
        ...created,
        title:
          parts.title ||
          deck.title ||
          'Converted Presentation',
        slides: parts.slides,
        settings: deck.settings || {
          stepParagraphs: true,
          transitions: { preset: 'fade' },
        },
      },
      { actorEmail: authedUser?.email || null }
    );

    serveJson(res, 201, {
      success: true,
      presentation: updated,
      report,
      detectedLang: effectiveLang, // Include detected language for client navigation
    });
  } catch {
    jsonError(res, 500, 'presentation_create_failed', 'Failed to create presentation');
  }

  return true;
}

// POST /api/convert/stream - Convert a file, streaming progress over SSE
async function handleConvertStream({ storageScope, req, res, authedUser }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const { dataUrl, filename, vendor, lang, theme } = getConvertParams(body);

  if (!dataUrl) {
    return badRequest(
      res,
      'Expected { dataUrl: "data:..." }'
    );
  }
  if (!filename) {
    return badRequest(
      res,
      'Expected { filename: "..." }'
    );
  }

  // Parse the data URL
  const dataUrlMatch = dataUrl.match(
    /^data:([^;]+);base64,(.*)$/
  );
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
      `Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(
        ', '
      )}`
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

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Determine file type for contextual messages
  const isPptx =
    ext === 'pptx' ||
    ext === 'ppt' ||
    mimeType.includes('presentation');
  const isPdf =
    ext === 'pdf' || mimeType === 'application/pdf';
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
    // Stream initial messages with delays
    // These are shown during file parsing which is fast, so we show them with minimal delay
    // The real waiting happens during AI processing where content-aware messages are shown
    let progress = 5;
    const progressStep = Math.floor(
      20 / initialMessages.length
    );

    for (const msg of initialMessages) {
      sendEvent('status', {
        message: msg,
        phase: 'parse',
        progress,
      });
      progress += progressStep;
      await new Promise((r) => setTimeout(r, 1200));
    }

    // Show "analyzing content" message while AI processes
    sendEvent('status', {
      message: isNl
        ? 'Inhoud analyseren en structuur bepalen...'
        : 'Analyzing content and structure...',
      phase: 'analyze',
      progress: 28,
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
      onStatusMessage: (msg) => {
        statusMessages.push(msg);
        // Send messages immediately as they arrive (for real-time feel)
        if (!statusMessagesSent) {
          sendEvent('status', {
            message: msg,
            phase: 'convert',
            progress: Math.min(
              25 + statusMessages.length * 3,
              75
            ),
          });
        }
      },
      onOutlineComplete: (outline) => {
        // When outline is ready, send all status messages at once for client rotation
        if (outline?.statusMessages?.length > 0) {
          statusMessagesSent = true;
          sendEvent('messages', {
            statusMessages: outline.statusMessages,
          });
        }
      },
    });

    // If no messages were streamed during conversion, send what we have
    if (
      statusMessages.length > 0 &&
      !statusMessagesSent
    ) {
      sendEvent('messages', { statusMessages });
    }

    if (!deck || report.errors.length > 0) {
      sendEvent(
        'error',
        sseErrorPayload(report.errors.join('; ') || 'Conversion failed', { report })
      );
      res.end();
      return true;
    }

    // Post-conversion messages
    const slideCount = deck?.slides?.length || 0;
    sendEvent('status', {
      message: isNl
        ? `${slideCount} slide${
            slideCount !== 1 ? 's' : ''
          } gegenereerd`
        : `Generated ${slideCount} slide${
            slideCount !== 1 ? 's' : ''
          }`,
      progress: 85,
      phase: 'finalize',
    });
    await new Promise((r) => setTimeout(r, 300));

    sendEvent('status', {
      message: isNl
        ? 'Presentatie opbouwen...'
        : 'Building presentation...',
      progress: 90,
      phase: 'finalize',
    });
    await new Promise((r) => setTimeout(r, 200));

    // Create presentation
    sendEvent('status', {
      message: isNl
        ? 'Opslaan in bibliotheek...'
        : 'Saving to library...',
      progress: 95,
      phase: 'save',
    });

    const parts = deckToPresentationParts(deck);

    // Use the detected/effective language from the deck, not the original request
    const effectiveLang =
      deck.lang ||
      deck._generationMeta?.effectiveLang ||
      'nl';

    const created = await createPresentation(storageScope, {
      title:
        parts.title ||
        deck.title ||
        'Converted Presentation',
      theme: theme,
      ownerEmail: authedUser?.email || null,
      lang: effectiveLang,
    });

    const updated = await updatePresentation(storageScope,
      created.id,
      {
        ...created,
        title:
          parts.title ||
          deck.title ||
          'Converted Presentation',
        slides: parts.slides,
        settings: deck.settings || {
          stepParagraphs: true,
          transitions: { preset: 'fade' },
        },
      },
      { actorEmail: authedUser?.email || null }
    );

    sendEvent('complete', {
      presentation: updated,
      report,
      detectedLang: effectiveLang, // Include detected language for client navigation
    });
  } catch (e) {
    log.error('[Convert Stream] Error:', e);
    sendEvent('error', sseErrorPayload(e.message || 'Conversion failed'));
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
  { method: 'POST', pattern: '/api/convert/stream', handler: handleConvertStream },
  { method: 'GET', pattern: '/api/convert/status', handler: handleConvertStatus },
];

/**
 * Handle /api/convert routes.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleConvert(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
