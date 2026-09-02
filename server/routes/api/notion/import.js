/**
 * Notion import endpoint handlers.
 * Handles importing Notion pages as presentations (standard and streaming).
 */

import {
  badRequest,
  serveJson,
  jsonError,
  requireJsonBody,
} from '../../../utils/http.js';
import {
  getTrimmedString,
  getOptionalString,
  getLangOrAuto,
} from '../../../utils/request-validators.js';
import { extractPageId, notionEnabled } from '../../../utils/notion/index.js';
import { convertNotionPage } from '../../../utils/convert-notion.js';
import {
  createPresentation,
  updatePresentation,
} from '../../../storage/presentations/index.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { handleNotionError, refuseNotionUnconfigured } from './utils.js';
import { createLogger } from '../../../utils/logger.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';
const log = createLogger('import');

/**
 * Handle POST /api/notion/import
 * Import from Notion: convert a Notion page to a full presentation.
 * Uses the same AI pipeline as file conversion.
 */
export async function handleNotionImport({
  req,
  res,
  authedUser,
  storageScope,
}) {
  if (!notionEnabled()) return refuseNotionUnconfigured(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const urlOrId = getTrimmedString(body, 'url') || '';
  const lang = getLangOrAuto(body);
  const theme = getTrimmedString(body, 'theme') || 'default';
  const vendor = getOptionalString(body, 'vendor');

  if (!urlOrId) {
    return badRequest(res, 'Expected { url } with a Notion page URL or ID');
  }

  const pageId = extractPageId(urlOrId);
  if (!pageId) {
    return badRequest(res, 'Invalid Notion URL or page ID format');
  }

  try {
    // Convert the Notion page
    const {
      deck,
      report,
      pageId: normalizedPageId,
    } = await convertNotionPage(urlOrId, {
      lang,
      vendor,
      enableLogging: true,
    });

    if (!deck || report.errors.length > 0) {
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
    const parts = deckToPresentationParts(deck);
    const effectiveLang =
      deck.lang || deck._generationMeta?.effectiveLang || DEFAULT_DECK_LANG;

    const created = await createPresentation(storageScope, {
      title: parts.title || deck.title || 'Imported from Notion',
      theme,
      ownerEmail: authedUser?.email || null,
      lang: effectiveLang,
      notionSourcePageId: normalizedPageId, // Store for "Publish to Notion" feature
      settings: {
        stepParagraphs: true,
        transitions: { preset: 'fade' },
      },
    });

    const updated = await updatePresentation(
      storageScope,
      created.id,
      {
        ...created,
        title: parts.title || deck.title || 'Imported from Notion',
        slides: parts.slides,
      },
      { actorEmail: authedUser?.email || null },
    );

    serveJson(res, 201, {
      success: true,
      presentation: updated,
      report,
      detectedLang: effectiveLang,
    });
  } catch (e) {
    handleNotionError(e, res);
  }
  return true;
}

/**
 * Handle POST /api/notion/import/stream
 * Streaming import from Notion: provides real-time status updates via SSE.
 */
export async function handleNotionImportStream({
  req,
  res,
  authedUser,
  storageScope,
}) {
  if (!notionEnabled()) return refuseNotionUnconfigured(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const urlOrId = getTrimmedString(body, 'url') || '';
  const lang = getLangOrAuto(body);
  const theme = getTrimmedString(body, 'theme') || 'default';
  const vendor = getOptionalString(body, 'vendor');

  if (!urlOrId) {
    return badRequest(res, 'Expected { url } with a Notion page URL or ID');
  }

  const pageId = extractPageId(urlOrId);
  if (!pageId) {
    return badRequest(res, 'Invalid Notion URL or page ID format');
  }

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;

  // Initial messages (Dutch by default - actual content language is auto-detected)
  const isNl = true;
  const initialMessages = isNl
    ? [
        'Notion-pagina ophalen...',
        'Inhoud analyseren...',
        'Afbeeldingen verwerken...',
      ]
    : [
        'Fetching Notion page...',
        'Analyzing content...',
        'Processing images...',
      ];

  try {
    let progress = 5;
    const progressStep = Math.floor(20 / initialMessages.length);

    for (const msg of initialMessages) {
      sseWrite(res, {
        event: 'status',
        data: { message: msg, phase: 'fetch', progress },
      });
      progress += progressStep;
      await new Promise((r) => setTimeout(r, 1200));
    }

    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl
          ? 'Inhoud converteren naar slides...'
          : 'Converting content to slides...',
        phase: 'convert',
        progress: 28,
      },
    });

    const statusMessages = [];
    let statusMessagesSent = false;

    // Convert with streaming callbacks
    const {
      deck,
      report,
      pageId: normalizedPageId,
    } = await convertNotionPage(urlOrId, {
      lang,
      vendor,
      enableLogging: true,
      onStatusMessage: (msg) => {
        statusMessages.push(msg);
        if (!statusMessagesSent) {
          sseWrite(res, {
            event: 'status',
            data: {
              message: msg,
              phase: 'convert',
              progress: Math.min(25 + statusMessages.length * 3, 75),
            },
          });
        }
      },
      onOutlineComplete: (outline) => {
        if (outline?.statusMessages?.length > 0) {
          statusMessagesSent = true;
          sseWrite(res, {
            event: 'messages',
            data: { statusMessages: outline.statusMessages },
          });
        }
      },
    });

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
        progress: 85,
        phase: 'finalize',
      },
    });
    await new Promise((r) => setTimeout(r, 300));

    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl ? 'Presentatie opbouwen...' : 'Building presentation...',
        progress: 90,
        phase: 'finalize',
      },
    });
    await new Promise((r) => setTimeout(r, 200));

    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl ? 'Opslaan in bibliotheek...' : 'Saving to library...',
        progress: 95,
        phase: 'save',
      },
    });

    // Create the presentation
    const parts = deckToPresentationParts(deck);
    const effectiveLang =
      deck.lang || deck._generationMeta?.effectiveLang || DEFAULT_DECK_LANG;

    const created = await createPresentation(storageScope, {
      title: parts.title || deck.title || 'Imported from Notion',
      theme,
      ownerEmail: authedUser?.email || null,
      lang: effectiveLang,
      notionSourcePageId: normalizedPageId,
      settings: {
        stepParagraphs: true,
        transitions: { preset: 'fade' },
      },
    });

    const updated = await updatePresentation(
      storageScope,
      created.id,
      {
        ...created,
        title: parts.title || deck.title || 'Imported from Notion',
        slides: parts.slides,
      },
      { actorEmail: authedUser?.email || null },
    );

    sseWrite(res, {
      event: 'complete',
      data: {
        presentation: updated,
        report,
        detectedLang: effectiveLang,
      },
    });
  } catch (e) {
    log.error('[Notion Import Stream] Error:', e);
    const msg = String(e?.message || e || 'Unknown error');
    sseError(res, msg);
  }

  res.end();
  return true;
}
