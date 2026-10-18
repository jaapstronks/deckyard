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
import { assertCreatableDeckInput } from '../../../services/presentations.js';
import { createImportedPresentation } from '../../../services/import-json.js';
import { generatedDeckToParts } from '../../../utils/ai/index.js';
import { loadAiThemeContext } from '../../../utils/themes.js';
import { handleNotionError, refuseNotionUnconfigured } from './utils.js';
import { createLogger } from '../../../utils/logger.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import { clientDisconnectSignal } from '../../../utils/client-disconnect.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';
import {
  createSseProgress,
  SOURCE_MESSAGES,
} from '../../../utils/import-progress.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { loadSlideTypeOffer } from '../../../utils/org-slide-types.js';
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
  // The theme context and title slide type go to the model too (B757).
  const {
    themeId: theme,
    theme: themeConfig,
    themeContext,
    titleSlideType,
  } = await loadAiThemeContext(repoRoot, body?.theme, storageScope);

  // Cancelling is dropping the request: the signal aborts the model calls
  // and the image uploads, and is checked before the presentation is written.
  const signal = clientDisconnectSignal(res);
  // One map for the AI fix pipeline and the deck import (B247).
  const slideTypes = await buildMergedSlideTypes(storageScope);
  // The catalog the model chooses from is the org's, as on every AI path
  // (B659).
  const slideTypeOffer = await loadSlideTypeOffer(authedUser);

  try {
    // Convert the Notion page
    const {
      deck,
      report,
      pageId: normalizedPageId,
    } = await convertNotionPage(urlOrId, {
      lang,
      vendor,
      signal,
      slideTypes,
      ...slideTypeOffer,
      themeContext,
      titleSlideType,
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
    // The language the generation settled on; review metadata kept (B757).
    const effectiveLang = deck.lang || DEFAULT_DECK_LANG;
    const parts = generatedDeckToParts(deck, {
      theme: themeConfig,
      slideTypes,
    });

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();

    const updated = await createImportedPresentation(
      storageScope,
      { actor: authedUser },
      {
        parts,
        slideTypes,
        lang: effectiveLang,
        theme,
        fields: {
          title: parts.title || deck.title || 'Imported from Notion',
          // Stored for "Publish to Notion".
          notionSourcePageId: normalizedPageId,
          settings: {
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
  // The theme context and title slide type go to the model too (B757).
  const {
    themeId: theme,
    theme: themeConfig,
    themeContext,
    titleSlideType,
  } = await loadAiThemeContext(repoRoot, body?.theme, storageScope);

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  // Cancelling is closing the stream: the signal aborts the model calls and
  // the image re-hosting, and is checked before the presentation is written.
  const { signal } = stream;

  try {
    signal.throwIfAborted();
    // The one progress writer (B758): this route reports nothing itself.
    const progress = createSseProgress(res, {
      lang,
      initialMessages: SOURCE_MESSAGES.notion,
    });
    // One map for the AI fix pipeline and the deck import (B247).
    const slideTypes = await buildMergedSlideTypes(storageScope);
    // The catalog the model chooses from is the org's (B659).
    const slideTypeOffer = await loadSlideTypeOffer(authedUser);

    const {
      deck,
      report,
      pageId: normalizedPageId,
    } = await convertNotionPage(urlOrId, {
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

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();
    progress.save();

    // Create the presentation
    // The language the generation settled on; review metadata kept (B757).
    const effectiveLang = deck.lang || DEFAULT_DECK_LANG;
    const parts = generatedDeckToParts(deck, {
      theme: themeConfig,
      slideTypes,
    });

    const updated = await createImportedPresentation(
      storageScope,
      { actor: authedUser },
      {
        parts,
        slideTypes,
        lang: effectiveLang,
        theme,
        fields: {
          title: parts.title || deck.title || 'Imported from Notion',
          // Stored for "Publish to Notion".
          notionSourcePageId: normalizedPageId,
          settings: {
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
