/**
 * Notion import endpoint handlers.
 * Handles importing Notion pages as presentations (standard and streaming).
 */

import { badRequest, json, serveJson } from '../../../utils/http.js';
import {
  getTrimmedString,
  getOptionalString,
  getLangOrAuto,
} from '../../../utils/request-validators.js';
import { extractPageId, notionEnabled } from '../../../utils/notion.js';
import { convertNotionPage } from '../../../utils/convert-notion.js';
import {
  createPresentation,
  updatePresentation,
} from '../../../storage/presentations.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('import');

/**
 * Handle POST /api/notion/import
 * Import from Notion: convert a Notion page to a full presentation.
 * Uses the same AI pipeline as file conversion.
 */
export async function handleNotionImport({ req, res, url, authedUser, repoRoot }) {
  if (url.pathname !== '/api/notion/import' || req.method !== 'POST') {
    return false;
  }

  if (!notionEnabled()) {
    serveJson(res, 501, {
      error: 'Notion not configured',
      details: 'Set NOTION_SECRET on the server to enable this feature.',
    });
    return true;
  }

  const body = await json(req);
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
    const { deck, report, pageId: normalizedPageId } = await convertNotionPage(urlOrId, {
      lang,
      vendor,
      enableLogging: true,
    });

    if (!deck || report.errors.length > 0) {
      serveJson(res, 422, {
        success: false,
        report,
        error: report.errors.join('; ') || 'Conversion failed',
      });
      return true;
    }

    // Create the presentation from the deck
    const parts = deckToPresentationParts(deck);
    const effectiveLang = deck.lang || deck._generationMeta?.effectiveLang || 'nl';

    const created = await createPresentation(repoRoot, {
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
      repoRoot,
      created.id,
      {
        ...created,
        title: parts.title || deck.title || 'Imported from Notion',
        slides: parts.slides,
      },
      { actorEmail: authedUser?.email || null }
    );

    serveJson(res, 201, {
      success: true,
      presentation: updated,
      report,
      detectedLang: effectiveLang,
    });
  } catch (e) {
    const msg = String(e?.message || e || 'Unknown error');
    const code = e?.statusCode || 500;
    if (msg.includes('Could not find') || code === 404) {
      return badRequest(res, 'Notion page not found. Make sure the page is shared with your Notion integration.');
    }
    if (msg.includes('unauthorized') || code === 401 || code === 403) {
      return badRequest(res, 'Access denied. Make sure the page is shared with your Notion integration.');
    }
    serveJson(res, code >= 400 && code < 600 ? code : 500, { error: msg });
  }
  return true;
}

/**
 * Handle POST /api/notion/import/stream
 * Streaming import from Notion: provides real-time status updates via SSE.
 */
export async function handleNotionImportStream({ req, res, url, authedUser, repoRoot }) {
  if (url.pathname !== '/api/notion/import/stream' || req.method !== 'POST') {
    return false;
  }

  if (!notionEnabled()) {
    serveJson(res, 501, {
      error: 'Notion not configured',
      details: 'Set NOTION_SECRET on the server to enable this feature.',
    });
    return true;
  }

  const body = await json(req);
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

  // Initial messages (Dutch by default - actual content language is auto-detected)
  const isNl = true;
  const initialMessages = isNl
    ? ['Notion-pagina ophalen...', 'Inhoud analyseren...', 'Afbeeldingen verwerken...']
    : ['Fetching Notion page...', 'Analyzing content...', 'Processing images...'];

  try {
    let progress = 5;
    const progressStep = Math.floor(20 / initialMessages.length);

    for (const msg of initialMessages) {
      sendEvent('status', { message: msg, phase: 'fetch', progress });
      progress += progressStep;
      await new Promise((r) => setTimeout(r, 1200));
    }

    sendEvent('status', {
      message: isNl ? 'Inhoud converteren naar slides...' : 'Converting content to slides...',
      phase: 'convert',
      progress: 28,
    });

    const statusMessages = [];
    let statusMessagesSent = false;

    // Convert with streaming callbacks
    const { deck, report, pageId: normalizedPageId } = await convertNotionPage(urlOrId, {
      lang,
      vendor,
      enableLogging: true,
      onStatusMessage: (msg) => {
        statusMessages.push(msg);
        if (!statusMessagesSent) {
          sendEvent('status', {
            message: msg,
            phase: 'convert',
            progress: Math.min(25 + statusMessages.length * 3, 75),
          });
        }
      },
      onOutlineComplete: (outline) => {
        if (outline?.statusMessages?.length > 0) {
          statusMessagesSent = true;
          sendEvent('messages', { statusMessages: outline.statusMessages });
        }
      },
    });

    if (statusMessages.length > 0 && !statusMessagesSent) {
      sendEvent('messages', { statusMessages });
    }

    if (!deck || report.errors.length > 0) {
      sendEvent('error', {
        error: report.errors.join('; ') || 'Conversion failed',
        report,
      });
      res.end();
      return true;
    }

    // Post-conversion messages
    const slideCount = deck?.slides?.length || 0;
    sendEvent('status', {
      message: isNl
        ? `${slideCount} slide${slideCount !== 1 ? 's' : ''} gegenereerd`
        : `Generated ${slideCount} slide${slideCount !== 1 ? 's' : ''}`,
      progress: 85,
      phase: 'finalize',
    });
    await new Promise((r) => setTimeout(r, 300));

    sendEvent('status', {
      message: isNl ? 'Presentatie opbouwen...' : 'Building presentation...',
      progress: 90,
      phase: 'finalize',
    });
    await new Promise((r) => setTimeout(r, 200));

    sendEvent('status', {
      message: isNl ? 'Opslaan in bibliotheek...' : 'Saving to library...',
      progress: 95,
      phase: 'save',
    });

    // Create the presentation
    const parts = deckToPresentationParts(deck);
    const effectiveLang = deck.lang || deck._generationMeta?.effectiveLang || 'nl';

    const created = await createPresentation(repoRoot, {
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
      repoRoot,
      created.id,
      {
        ...created,
        title: parts.title || deck.title || 'Imported from Notion',
        slides: parts.slides,
      },
      { actorEmail: authedUser?.email || null }
    );

    sendEvent('complete', {
      presentation: updated,
      report,
      detectedLang: effectiveLang,
    });
  } catch (e) {
    log.error('[Notion Import Stream] Error:', e);
    const msg = String(e?.message || e || 'Unknown error');
    sendEvent('error', { error: msg });
  }

  res.end();
  return true;
}