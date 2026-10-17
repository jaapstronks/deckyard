/**
 * API route for converting PowerPoint/PDF files to presentations.
 */

import { assertCreatableDeckInput } from '../../services/presentations.js';
import { createImportedPresentation } from '../../services/import-json.js';
import { isAppError } from '../../utils/errors.js';
import {
  badRequest,
  jsonError,
  serveJson,
  requireJsonBody,
  withErrorHandler,
} from '../../utils/http.js';
import { getConvertParams } from '../../utils/request-validators.js';
import { generatedDeckToParts } from '../../utils/ai/index.js';
import { loadAiThemeContext } from '../../utils/themes.js';
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
import { loadSlideTypeOffer } from '../../utils/org-slide-types.js';
import {
  createSseProgress,
  SOURCE_MESSAGES,
} from '../../utils/import-progress.js';
import { buildMergedSlideTypes } from '../../utils/custom-slide-type-runtime.js';

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
  // The theme context and title slide type go to the model too (B757).
  const {
    themeId,
    theme: themeConfig,
    themeContext,
    titleSlideType,
  } = await loadAiThemeContext(repoRoot, theme, storageScope);

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
  // One map for the AI fix pipeline and the deck import (B247).
  const slideTypes = await buildMergedSlideTypes(storageScope);
  // The catalog the model chooses from is the org's, as on every AI path
  // (B659).
  const slideTypeOffer = await loadSlideTypeOffer(authedUser);

  // Convert the file
  let converted;
  try {
    converted = await convertFile(buffer, {
      filename,
      mimeType,
      lang,
      vendor,
      signal,
      slideTypes,
      ...slideTypeOffer,
      themeContext,
      titleSlideType,
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
    // Review metadata kept, as on every generation path (B757).
    const parts = generatedDeckToParts(deck, {
      theme: themeConfig,
      slideTypes,
    });

    // The language the generation settled on, not the original request; a
    // Markdown file converts without the model and may name none.
    const effectiveLang = deck.lang || DEFAULT_DECK_LANG;

    // The write step: no deck is created for a client that already left.
    if (signal.aborted) {
      log.info('[Convert] cancelled by the client');
      return true;
    }

    const updated = await createImportedPresentation(
      storageScope,
      { actor: authedUser },
      {
        parts,
        slideTypes,
        lang: effectiveLang,
        theme: themeId,
        fields: {
          title: parts.title || deck.title || 'Converted Presentation',
          settings: deck.settings || {
            stepParagraphs: true,
            transitions: { preset: 'fade' },
          },
        },
      },
    );

    serveJson(res, 201, {
      success: true,
      presentation: updated,
      report,
      detectedLang: effectiveLang, // Include detected language for client navigation
    });
  } catch (e) {
    // A refusal (an invalid slide field, a quota) keeps its own envelope.
    if (isAppError(e)) throw e;
    jsonError(
      res,
      500,
      'presentation_create_failed',
      'Failed to create presentation',
    );
  }

  return true;
}

/**
 * The kind of file, for the rotator's list while the source is read.
 * @param {string} ext
 * @param {string} mimeType
 * @returns {'pptx'|'pdf'|'document'|'file'}
 */
function sourceKind(ext, mimeType) {
  if (ext === 'pptx' || ext === 'ppt' || mimeType.includes('presentation')) {
    return 'pptx';
  }
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (
    ext === 'docx' ||
    ext === 'rtf' ||
    ext === 'odt' ||
    mimeType.includes('wordprocessingml') ||
    mimeType.includes('opendocument.text') ||
    mimeType === 'application/rtf' ||
    mimeType === 'text/rtf'
  ) {
    return 'document';
  }
  return 'file';
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
  // The theme context and title slide type go to the model too (B757).
  const {
    themeId,
    theme: themeConfig,
    themeContext,
    titleSlideType,
  } = await loadAiThemeContext(repoRoot, theme, storageScope);

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

  try {
    signal.throwIfAborted();
    // The one progress writer (B758): this route reports nothing itself.
    const progress = createSseProgress(res, {
      lang,
      initialMessages: SOURCE_MESSAGES[sourceKind(ext, mimeType)],
    });
    // One map for the AI fix pipeline and the deck import (B247).
    const slideTypes = await buildMergedSlideTypes(storageScope);
    // The catalog the model chooses from is the org's (B659).
    const slideTypeOffer = await loadSlideTypeOffer(authedUser);

    const { deck, report } = await convertFile(buffer, {
      filename,
      mimeType,
      lang,
      vendor,
      signal,
      slideTypes,
      ...slideTypeOffer,
      themeContext,
      titleSlideType,
      onOutline: progress.onOutline,
      onStatusMessage: progress.onStatusMessage,
      onGroupDone: progress.onGroupDone,
    });

    if (!deck || report.errors.length > 0) {
      sseError(res, report.errors.join('; ') || 'Conversion failed', {
        report,
      });
      res.end();
      return true;
    }

    progress.finalize(deck.slides?.length || 0);

    // Review metadata kept, as on every generation path (B757).
    const parts = generatedDeckToParts(deck, {
      theme: themeConfig,
      slideTypes,
    });

    // The language the generation settled on, not the original request; a
    // Markdown file converts without the model and may name none.
    const effectiveLang = deck.lang || DEFAULT_DECK_LANG;

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();
    progress.save();

    const updated = await createImportedPresentation(
      storageScope,
      { actor: authedUser },
      {
        parts,
        slideTypes,
        lang: effectiveLang,
        theme: themeId,
        fields: {
          title: parts.title || deck.title || 'Converted Presentation',
          settings: deck.settings || {
            stepParagraphs: true,
            transitions: { preset: 'fade' },
          },
        },
      },
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
