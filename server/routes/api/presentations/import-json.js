import {
  createPresentation,
  updatePresentation,
} from '../../../storage/presentations/index.js';
import { serveJson, requireJsonBody } from '../../../utils/http.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { loadThemeAssets, resolveThemeId } from '../../../utils/themes.js';
import { createLogger } from '../../../utils/logger.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
} from '../../../../shared/i18n-utils.js';
const log = createLogger('import-json');

// Error handling lives in the `withErrorHandler` wrapper on the presentations
// dispatcher: typed AppErrors (sandbox quota, validation) surface their own
// status + safe message, anything else is a generic 500 — err.message/stack
// never reach the client (public in sandbox/demo mode, security-audit H7).
export async function handlePresentationsImportJson({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
} = {}) {
  log.info('[import-json] Starting import...');
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;

  const deck = body?.deck || body;
  const lang = normalizeLang(body?.lang) || DEFAULT_DECK_LANG;
  log.info('[import-json] Language:', lang);
  log.info('[import-json] Deck title:', deck?.title);
  log.info(
    '[import-json] Deck slides count:',
    Array.isArray(deck?.slides) ? deck.slides.length : 'not an array',
  );

  // Load the deck's theme first so imported title slides can take a
  // background image from its presets.
  let themeConfig = null;
  try {
    themeConfig = await loadThemeAssets(repoRoot, resolveThemeId(deck?.theme));
  } catch {
    // ignore — title slides are imported without a background image
  }

  const parts = deckToPresentationParts(deck, { theme: themeConfig });
  log.info(
    '[import-json] Parsed parts - title:',
    parts.title,
    'theme:',
    parts.theme,
    'slides:',
    parts.slides?.length,
  );

  const created = await createPresentation(storageScope, {
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
    storageScope,
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
    },
  );
  log.info('[import-json] Updated presentation successfully');

  serveJson(res, 201, updated);
  return true;
}
