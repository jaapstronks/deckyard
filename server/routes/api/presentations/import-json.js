import { createPresentation, updatePresentation } from '../../../storage/presentations.js';
import { json, serveJson } from '../../../utils/http.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { loadTheme, resolveThemeId } from '../../../utils/themes.js';

export async function handlePresentationsImportJson({
  repoRoot,
  req,
  res,
  authedUser,
} = {}) {
  try {
    console.log('[import-json] Starting import...');
    const body = await json(req);
    console.log('[import-json] Received body:', JSON.stringify(body).slice(0, 500));

    const deck = body?.deck || body;
    const lang = body?.lang === 'nl' || body?.lang === 'en-GB' ? body.lang : 'nl';
    console.log('[import-json] Language:', lang);
    console.log('[import-json] Deck title:', deck?.title);
    console.log('[import-json] Deck slides count:', Array.isArray(deck?.slides) ? deck.slides.length : 'not an array');

    // Load the deck's theme first so imported title slides can take a
    // background image from its presets.
    let themeConfig = null;
    try {
      themeConfig = await loadTheme(repoRoot, resolveThemeId(deck?.theme));
    } catch {
      // ignore — title slides are imported without a background image
    }

    const parts = deckToPresentationParts(deck, { theme: themeConfig });
    console.log('[import-json] Parsed parts - title:', parts.title, 'theme:', parts.theme, 'slides:', parts.slides?.length);

    const created = await createPresentation(repoRoot, {
      title: parts.title,
      theme: parts.theme,
      lang,
      ownerEmail: authedUser?.email || null,
    });
    console.log('[import-json] Created presentation:', created.id);

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
    console.log('[import-json] Updated presentation successfully');

    serveJson(res, 201, updated);
    return true;
  } catch (err) {
    console.error('[import-json] Error:', err.message);
    console.error('[import-json] Stack:', err.stack);
    serveJson(res, 500, { error: err.message, stack: err.stack });
    return true;
  }
}
