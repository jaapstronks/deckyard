import { badRequest, json, serveJson } from '../../../utils/http.js';
import { getAiParams, getTrimmedString } from '../../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { generateDeckJsonFromRawContent } from '../../../utils/ai.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';
import { sandboxDefaultThemeId, sandboxEnabled } from '../../../config/sandbox.js';
import { loadSlideTypeContext, createPresentationWithI18n } from './shared.js';

/**
 * POST /api/ai/wizard — generate a deck from raw input and create a new presentation.
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiWizard({ repoRoot, req, res, authedUser }) {
  const body = await json(req);
  const {
    raw,
    vendor,
    lang,
    theme: themeFromRequest,
    settings: settingsFromRequest,
  } = getAiParams(body);
  if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
  const notionSourcePageId = getTrimmedString(body, 'notionSourcePageId');

  const userName = getDisplayNameForUser(authedUser);
  const slideTypeCtx = await loadSlideTypeContext(authedUser);
  const deck = await generateDeckJsonFromRawContent(raw, {
    userName,
    targetLang: lang,
    vendor,
    disabledSlideTypes: slideTypeCtx.disabled,
    customSlideTypes: slideTypeCtx.custom,
  });
  const parts = deckToPresentationParts(deck);

  // Theme is chosen by the user at creation time; do not let the model/environment decide.
  const effectiveTheme =
    themeFromRequest || (sandboxEnabled() ? sandboxDefaultThemeId() : parts.theme);

  const updated = await createPresentationWithI18n(repoRoot, {
    parts,
    lang,
    authedUser,
    theme: effectiveTheme,
    settings: settingsFromRequest,
    notionSourcePageId,
  });
  serveJson(res, 201, updated);
  return true;
}
