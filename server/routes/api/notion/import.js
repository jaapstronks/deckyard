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
import { updatePresentation } from '../../../storage/presentations/index.js';
import {
  assertCreatableDeckInput,
  createPresentation,
} from '../../../services/presentations.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { settleNewDeckTheme } from '../../../utils/themes.js';
import { handleNotionError, refuseNotionUnconfigured } from './utils.js';
import { createLogger } from '../../../utils/logger.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import { clientDisconnectSignal } from '../../../utils/client-disconnect.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';
import {
  OUTLINE_CREEP_MS,
  PROGRESS,
  REFINE_CREEP_MS,
} from '../../../utils/import-progress.js';
const log = createLogger('import');

/**
 * Handle POST /api/notion/import
 * Import from Notion: convert a Notion page to a full presentation.
 * Uses the same AI pipeline as file conversion.
 */
export async function handleNotionImport({
  repoRoot,
  req,
  res,
  authedUser,
  storageScope,
}) {
  if (!notionEnabled()) return refuseNotionUnconfigured(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before the conversion, so a refused body costs no work (B576).
  assertCreatableDeckInput(body);
  const urlOrId = getTrimmedString(body, 'url') || '';
  const lang = getLangOrAuto(body);
  const vendor = getOptionalString(body, 'vendor');

  if (!urlOrId) {
    return badRequest(res, 'Expected { url } with a Notion page URL or ID');
  }

  const pageId = extractPageId(urlOrId);
  if (!pageId) {
    return badRequest(res, 'Invalid Notion URL or page ID format');
  }
  // Checked before the conversion, so an unknown theme costs no work (B486).
  const { themeId: theme, theme: themeConfig } = await settleNewDeckTheme(
    repoRoot,
    body?.theme,
    storageScope,
  );

  // Cancelling is dropping the request: the signal aborts the model calls
  // and the image uploads, and is checked before the presentation is written.
  const signal = clientDisconnectSignal(res);

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
      signal,
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
    const effectiveLang =
      deck.lang || deck._generationMeta?.effectiveLang || DEFAULT_DECK_LANG;
    const parts = deckToPresentationParts(deck, {
      theme: themeConfig,
      lang: effectiveLang,
    });

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();

    const created = await createPresentation(
      storageScope,
      { actor: authedUser },
      {
        title: parts.title || deck.title || 'Imported from Notion',
        theme,
        lang: effectiveLang,
        notionSourcePageId: normalizedPageId, // Store for "Publish to Notion" feature
        settings: {
          stepParagraphs: true,
          transitions: { preset: 'fade' },
        },
      },
    );

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
    if (signal.aborted) log.info('[Notion Import] cancelled by the client');
    else handleNotionError(e, res);
  }
  return true;
}

/**
 * Handle POST /api/notion/import/stream
 * Streaming import from Notion: provides real-time status updates via SSE.
 */
export async function handleNotionImportStream({
  repoRoot,
  req,
  res,
  authedUser,
  storageScope,
}) {
  if (!notionEnabled()) return refuseNotionUnconfigured(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before the conversion, so a refused body costs no work (B576).
  assertCreatableDeckInput(body);
  const urlOrId = getTrimmedString(body, 'url') || '';
  const lang = getLangOrAuto(body);
  const vendor = getOptionalString(body, 'vendor');

  if (!urlOrId) {
    return badRequest(res, 'Expected { url } with a Notion page URL or ID');
  }

  const pageId = extractPageId(urlOrId);
  if (!pageId) {
    return badRequest(res, 'Invalid Notion URL or page ID format');
  }
  // Checked before the conversion, so an unknown theme costs no work (B486).
  const { themeId: theme, theme: themeConfig } = await settleNewDeckTheme(
    repoRoot,
    body?.theme,
    storageScope,
  );

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  // Cancelling is closing the stream: the signal aborts the model calls and
  // the image re-hosting, and is checked before the presentation is written.
  const { signal } = stream;

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
    // Handed to the client's rotator rather than paced here with sleeps: the
    // fetch and the outline call start immediately (B595).
    signal.throwIfAborted();
    sseWrite(res, {
      event: 'messages',
      data: { statusMessages: initialMessages, intervalMs: 6000, loop: true },
    });
    sseWrite(res, {
      event: 'status',
      data: {
        message: initialMessages[0],
        phase: 'fetch',
        progress: PROGRESS.parse,
      },
    });

    // Fetching plus the outline call is one long stretch without events, so
    // the bar creeps toward the refine floor instead of standing still.
    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl
          ? 'Inhoud converteren naar slides...'
          : 'Converting content to slides...',
        phase: 'convert',
        progress: PROGRESS.parse,
        creepTo: PROGRESS.refineFloor,
        creepMs: OUTLINE_CREEP_MS,
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
        if (outline?.statusMessages?.length > 0) {
          statusMessagesSent = true;
          sseWrite(res, {
            event: 'messages',
            data: { statusMessages: outline.statusMessages },
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
      // Real progress: one event per finished section group.
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

    sseWrite(res, {
      event: 'status',
      data: {
        message: isNl ? 'Opslaan in bibliotheek...' : 'Saving to library...',
        progress: PROGRESS.save,
        phase: 'save',
      },
    });

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();

    // Create the presentation
    const effectiveLang =
      deck.lang || deck._generationMeta?.effectiveLang || DEFAULT_DECK_LANG;
    const parts = deckToPresentationParts(deck, {
      theme: themeConfig,
      lang: effectiveLang,
    });

    const created = await createPresentation(
      storageScope,
      { actor: authedUser },
      {
        title: parts.title || deck.title || 'Imported from Notion',
        theme,
        lang: effectiveLang,
        notionSourcePageId: normalizedPageId,
        settings: {
          stepParagraphs: true,
          transitions: { preset: 'fade' },
        },
      },
    );

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
    if (signal.aborted) {
      log.info('[Notion Import Stream] cancelled by the client');
    } else {
      log.error('[Notion Import Stream] Error:', e);
      const msg = String(e?.message || e || 'Unknown error');
      sseError(res, msg);
    }
  }

  res.end();
  return true;
}
