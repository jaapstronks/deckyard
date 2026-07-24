import { createPresentation, updatePresentation } from '../../../storage/presentations.js';
import { json, serveJson, serverError } from '../../../utils/http.js';
import { isAppError } from '../../../utils/errors.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { loadTheme, resolveThemeId } from '../../../utils/themes.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('import-json');

export async function handlePresentationsImportJson({
  repoRoot,
  req,
  res,
  authedUser,
} = {}) {
  try {
    log.info('[import-json] Starting import...');
    const body = await json(req);

    const deck = body?.deck || body;
    const lang = body?.lang === 'nl' || body?.lang === 'en-GB' ? body.lang : 'nl';
    log.info('[import-json] Language:', lang);
    log.info('[import-json] Deck title:', deck?.title);
    log.info('[import-json] Deck slides count:', Array.isArray(deck?.slides) ? deck.slides.length : 'not an array');

    // Load the deck's theme first so imported title slides can take a
    // background image from its presets.
    let themeConfig = null;
    try {
      themeConfig = await loadTheme(repoRoot, resolveThemeId(deck?.theme));
    } catch {
      // ignore — title slides are imported without a background image
    }

    const parts = deckToPresentationParts(deck, { theme: themeConfig });
    log.info('[import-json] Parsed parts - title:', parts.title, 'theme:', parts.theme, 'slides:', parts.slides?.length);

    const created = await createPresentation(repoRoot, {
      title: parts.title,
      theme: parts.theme,
      lang,
      ownerEmail: authedUser?.email || null,
    });
    log.info('[import-json] Created presentation:', created.id);

    // Build the update payload with proper i18n structure.
    // We need to update i18n.versions[lang] with the imported slides,
    // otherwise normalizeI18n will overwrite our slides with the default ones.
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
    log.info('[import-json] Updated presentation successfully');

    serveJson(res, 201, updated);
    return true;
  } catch (err) {
    // Typed application errors (e.g. sandbox quota, validation) carry their own
    // 4xx status + safe message — surface it instead of masking as a 500.
    if (isAppError(err)) {
      serveJson(res, err.statusCode, err.toJSON());
      return true;
    }
    // Log the detail server-side, but never return err.message/err.stack to the
    // client: in sandbox/demo mode every anonymous visitor is auto-provisioned
    // an authed user, so this response is effectively public (security-audit H7).
    log.error('[import-json] Error:', err.message);
    log.error('[import-json] Stack:', err.stack);
    serverError(res);
    return true;
  }
}
