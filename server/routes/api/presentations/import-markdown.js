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

import { createPresentation, updatePresentation } from '../../../storage/presentations/index.js';
import {
  jsonError,
  serveJson,
  badRequest,
  requireJsonBody,
} from '../../../utils/http.js';
import { getString, getTrimmedString } from '../../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { convertMarkdownText } from '../../../utils/markdown-import/index.js';
import { loadThemeAssets, resolveThemeId } from '../../../utils/themes.js';
import { createLogger } from '../../../utils/logger.js';
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

  const lang = body?.lang === 'nl' || body?.lang === 'en-GB' ? body.lang : 'nl';
  const theme = getTrimmedString(body, 'theme') || undefined;

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

  // Load the deck's theme first so imported title slides can take a
  // background image from its presets.
  let themeConfig = null;
  try {
    themeConfig = await loadThemeAssets(repoRoot, resolveThemeId(deck?.theme));
  } catch {
    // ignore — title slides are imported without a background image
  }

  // Normalize through deckToPresentationParts (same as JSON import)
  const parts = deckToPresentationParts(deck, { theme: themeConfig });
  log.info('[import-markdown] Normalized - title:', parts.title, 'theme:', parts.theme, 'slides:', parts.slides?.length);

  // Create presentation
  const created = await createPresentation(storageScope, {
    title: parts.title,
    theme: parts.theme,
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

  const updated = await updatePresentation(storageScope,
    created.id,
    {
      title: parts.title,
      theme: parts.theme,
      lang,
      slides: parts.slides,
      i18n,
    },
    {
      actorEmail: authedUser?.email || null,
    }
  );
  log.info('[import-markdown] Updated presentation successfully');

  serveJson(res, 201, {
    ...updated,
    _importReport: report,
  });
  return true;
}
