import { badRequest, serveJson, requireJsonBody } from '../../../utils/http.js';
import {
  getAiParams,
  getTrimmedString,
} from '../../../utils/request-validators.js';
import { loadAiThemeContext } from '../../../utils/themes.js';
import { assertCreatableDeckInput } from '../../../services/presentations.js';
import { generateDeck, generatedDeckToParts } from '../../../utils/ai/index.js';
import { clientDisconnectSignal } from '../../../utils/client-disconnect.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';
import { log, createDeckFromParts } from './shared.js';
import { loadSlideTypeOffer } from '../../../utils/org-slide-types.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';

/**
 * POST /api/ai/wizard — generate a deck from raw input and create a new
 * presentation, in one JSON answer. The same pipeline as the stream route
 * (B759), without the progress events.
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiWizard({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before the generation, so a refused body costs no LLM call (B576).
  assertCreatableDeckInput(body);
  const {
    raw,
    vendor,
    lang,
    theme: themeFromRequest,
    settings: settingsFromRequest,
  } = getAiParams(body);
  if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
  const notionSourcePageId = getTrimmedString(body, 'notionSourcePageId');
  // Theme is chosen by the user at creation time, never by the model: checked
  // before the generation, absent means the installation default (B486).
  const {
    themeId: effectiveTheme,
    titleSlideType,
    themeContext,
    theme,
  } = await loadAiThemeContext(repoRoot, themeFromRequest, storageScope);

  // Cancelling is dropping the request: the signal aborts the model calls and
  // is checked before the presentation is written.
  const signal = clientDisconnectSignal(res);
  const slideTypes = await buildMergedSlideTypes(storageScope);
  let deck;
  try {
    deck = await generateDeck(raw, {
      userName: getDisplayNameForUser(authedUser),
      targetLang: lang,
      vendor,
      theme: effectiveTheme,
      titleSlideType,
      themeContext,
      slideTypes,
      ...(await loadSlideTypeOffer(authedUser)),
      signal,
    });
  } catch (e) {
    if (!signal.aborted) throw e;
    log.info('[AI Wizard] cancelled by the client');
    return true;
  }
  const parts = generatedDeckToParts(deck, { theme, slideTypes });
  if (signal.aborted) {
    log.info('[AI Wizard] cancelled by the client');
    return true;
  }

  const updated = await createDeckFromParts(storageScope, {
    parts,
    lang: deck.lang,
    authedUser,
    theme: effectiveTheme,
    settings: settingsFromRequest,
    notionSourcePageId,
  });
  serveJson(res, 201, updated);
  return true;
}
