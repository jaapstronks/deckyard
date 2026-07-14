/**
 * API route for converting PowerPoint/PDF files to presentations.
 */

import {
  createPresentation,
  updatePresentation,
} from '../../storage/presentations.js';
import {
  badRequest,
  json,
  serveJson,
} from '../../utils/http.js';
import {
  getConvertParams,
} from '../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../shared/slide-types.js';
import {
  convertFile,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
} from '../../utils/convert-file/index.js';

/**
 * Handle /api/convert routes
 */
export async function handleConvert({
  repoRoot,
  req,
  res,
  url,
  authedUser,
}) {
  // POST /api/convert - Convert a file to a presentation
  if (
    url.pathname === '/api/convert' &&
    req.method === 'POST'
  ) {
    const body = await json(req);
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
      serveJson(res, 422, {
        success: false,
        report,
        error:
          report.errors.join('; ') || 'Conversion failed',
      });
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

      const created = await createPresentation(repoRoot, {
        title:
          parts.title ||
          deck.title ||
          'Converted Presentation',
        theme: theme,
        ownerEmail: authedUser?.email || null,
        lang: effectiveLang,
      });

      const updated = await updatePresentation(
        repoRoot,
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
    } catch (e) {
      serveJson(res, 500, {
        success: false,
        report,
        error: `Failed to create presentation: ${e.message}`,
      });
    }

    return true;
  }

  // POST /api/convert/stream - Streaming file conversion with status messages
  if (
    url.pathname === '/api/convert/stream' &&
    req.method === 'POST'
  ) {
    const body = await json(req);
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
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

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
        sendEvent('error', {
          error:
            report.errors.join('; ') || 'Conversion failed',
          report,
        });
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

      const created = await createPresentation(repoRoot, {
        title:
          parts.title ||
          deck.title ||
          'Converted Presentation',
        theme: theme,
        ownerEmail: authedUser?.email || null,
        lang: effectiveLang,
      });

      const updated = await updatePresentation(
        repoRoot,
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
      console.error('[Convert Stream] Error:', e);
      sendEvent('error', {
        error: e.message || 'Conversion failed',
      });
    }

    res.end();
    return true;
  }

  // GET /api/convert/status - Check if conversion is available
  if (
    url.pathname === '/api/convert/status' &&
    req.method === 'GET'
  ) {
    serveJson(res, 200, {
      available: true,
      supportedFormats: SUPPORTED_EXTENSIONS,
      supportedMimeTypes: SUPPORTED_MIME_TYPES,
    });
    return true;
  }

  return false;
}