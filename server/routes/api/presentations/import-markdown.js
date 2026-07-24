/**
 * POST /api/presentations/import/markdown
 *
 * Imports a markdown deck (plain text, no AI) into a new presentation.
 * Follows the same pattern as import-json.js.
 */

import { createPresentation, updatePresentation } from '../../../storage/presentations.js';
import {
  json,
  serveJson,
  serverError,
  badRequest,
} from '../../../utils/http.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { convertMarkdownText } from '../../../utils/markdown-import/index.js';
import { loadTheme, resolveThemeId } from '../../../utils/themes.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('import-markdown');

export async function handlePresentationsImportMarkdown({
  repoRoot,
  req,
  res,
  authedUser,
} = {}) {
  try {
    log.info('[import-markdown] Starting import...');
    const body = await json(req);

    const markdown = body?.markdown;
    if (!markdown || typeof markdown !== 'string') {
      badRequest(res, 'Missing required field: markdown (string)');
      return true;
    }

    const lang = body?.lang === 'nl' || body?.lang === 'en-GB' ? body.lang : 'nl';
    const theme = typeof body?.theme === 'string' ? body.theme.trim() : undefined;

    log.info('[import-markdown] Language:', lang);
    log.info('[import-markdown] Markdown length:', markdown.length);

    // Convert markdown to deck format
    const { deck, report } = await convertMarkdownText(markdown, { lang, theme });

    if (!deck) {
      log.error('[import-markdown] Conversion failed:', report.errors);
      serveJson(res, 422, {
        error: 'Markdown conversion failed',
        report,
      });
      return true;
    }

    log.info('[import-markdown] Converted:', report.slidesConverted, 'slides');

    // Load the deck's theme first so imported title slides can take a
    // background image from its presets.
    let themeConfig = null;
    try {
      themeConfig = await loadTheme(repoRoot, resolveThemeId(deck?.theme));
    } catch {
      // ignore — title slides are imported without a background image
    }

    // Normalize through deckToPresentationParts (same as JSON import)
    const parts = deckToPresentationParts(deck, { theme: themeConfig });
    log.info('[import-markdown] Normalized - title:', parts.title, 'theme:', parts.theme, 'slides:', parts.slides?.length);

    // Create presentation
    const created = await createPresentation(repoRoot, {
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

    const updated = await updatePresentation(
      repoRoot,
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
  } catch (err) {
    // Log server-side only; never leak err.message/err.stack to the client
    // (public in sandbox/demo mode — security-audit H7).
    log.error('[import-markdown] Error:', err.message);
    log.error('[import-markdown] Stack:', err.stack);
    serverError(res);
    return true;
  }
}
