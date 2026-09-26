/**
 * POST /api/presentations/import/markdown
 *
 * Imports a markdown deck (plain text, no AI) into a new presentation.
 * Follows the same pattern as import-json.js.
 *
 * Error handling lives in the `withErrorHandler` wrapper on the presentations
 * dispatcher: typed AppErrors (sandbox quota) surface their own status,
 * anything else is a generic 500 — err.message/stack never reach the client
 * (public in sandbox/demo mode, security-audit H7).
 */

import {
  createPresentation,
  updatePresentation,
} from '../../../storage/presentations/index.js';
import {
  jsonError,
  serveJson,
  badRequest,
  requireJsonBody,
} from '../../../utils/http.js';
import { getString } from '../../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { convertMarkdownText } from '../../../utils/markdown-import/index.js';
import { settleNewDeckTheme } from '../../../utils/themes.js';
import { createLogger } from '../../../utils/logger.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';
const log = createLogger('import-markdown');

export async function handlePresentationsImportMarkdown({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
} = {}) {
  log.info('[import-markdown] Starting import...');
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const markdown = getString(body, 'markdown');
  if (!markdown) {
    badRequest(res, 'Missing required field: markdown (string)');
    return true;
  }

  const lang = normalizeLang(body?.lang) || DEFAULT_DECK_LANG;
  const theme = body?.theme ?? undefined;

  log.info('[import-markdown] Language:', lang);
  log.info('[import-markdown] Markdown length:', markdown.length);

  // Convert markdown to deck format
  const { deck, report } = await convertMarkdownText(markdown, { lang, theme });

  if (!deck) {
    log.error('[import-markdown] Conversion failed:', report.errors);
    jsonError(res, 422, 'conversion_failed', 'Markdown conversion failed', {
      details: { report },
    });
    return true;
  }

  log.info('[import-markdown] Converted:', report.slidesConverted, 'slides');

  // The deck's theme, so imported slides compose against it (background
  // presets, theme slide-background variants). The request's theme wins over
  // the front matter's; either is checked like every create's (B486).
  const { themeId, theme: themeConfig } = await settleNewDeckTheme(
    repoRoot,
    theme ?? deck?.theme,
    storageScope,
  );

  // Normalize through deckToPresentationParts (same as JSON import)
  const parts = deckToPresentationParts(deck, { theme: themeConfig, lang });
  log.info(
    '[import-markdown] Normalized - title:',
    parts.title,
    'theme:',
    parts.theme,
    'slides:',
    parts.slides?.length,
  );

  // Create presentation
  const created = await createPresentation(storageScope, {
    title: parts.title,
    theme: themeId,
    lang,
    ownerEmail: authedUser?.email || null,
  });
  log.info('[import-markdown] Created presentation:', created.id);

  // Build i18n structure (same as JSON import)
  const i18n = {
    dominant: lang,
    active: lang,
    versions: {
      [lang]: {
        title: parts.title,
        slides: parts.slides,
      },
    },
  };

  const updated = await updatePresentation(
    storageScope,
    created.id,
    {
      title: parts.title,
      theme: themeId,
      lang,
      slides: parts.slides,
      i18n,
    },
    {
      actorEmail: authedUser?.email || null,
    },
  );
  log.info('[import-markdown] Updated presentation successfully');

  serveJson(res, 201, {
    ...updated,
    _importReport: report,
  });
  return true;
}
