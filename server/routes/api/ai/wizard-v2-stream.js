import { badRequest, requireJsonBody } from '../../../utils/http.js';
import {
  getAiParams,
  getOptionalString,
  getTrimmedString,
} from '../../../utils/request-validators.js';
import {
  generateDeck,
  generatedDeckToParts,
  generateSessionId,
  createSessionLogger,
} from '../../../utils/ai/index.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';
import { assertCreatableDeckInput } from '../../../services/presentations.js';
import { loadAiThemeContext } from '../../../utils/themes.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
import { createSseProgress } from '../../../utils/import-progress.js';
import { log, createDeckFromParts } from './shared.js';
import { loadSlideTypeOffer } from '../../../utils/org-slide-types.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';

/**
 * POST /api/ai/wizard-v2/stream — Server-Sent Events for progress + final
 * result. Streams status messages during generation, then the final
 * presentation.
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiWizardV2Stream({
  repoRoot,
  storageScope,
  req,
  res,
  authedUser,
}) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // Refused before the stream opens, so a refused body costs no LLM call (B576).
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
  const targetLength = getOptionalString(body, 'targetLength') || 'auto';

  const userName = getDisplayNameForUser(authedUser);
  const slideTypeOffer = await loadSlideTypeOffer(authedUser);
  // The map the org's types were offered from is the one they are refined,
  // fixed and composed in (B247).
  const slideTypes = await buildMergedSlideTypes(storageScope);
  const sessionId = generateSessionId();
  const logger = createSessionLogger(sessionId);
  // Settle the theme to get the correct title slide type and theme context
  // for AI; an unknown theme is refused here, before the stream opens.
  const {
    themeId: effectiveTheme,
    titleSlideType,
    themeContext,
    theme,
  } = await loadAiThemeContext(repoRoot, themeFromRequest, storageScope);

  log.info(
    `[AI Wizard V2 Stream] Starting session ${sessionId}, theme: ${effectiveTheme}, titleSlideType: ${titleSlideType}, targetLength: ${targetLength}`,
  );

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  // Cancelling is closing the stream: the signal aborts both model phases and
  // is checked before the presentation is written.
  const { signal } = stream;

  try {
    // The one progress writer (B758): this route reports nothing itself.
    const progress = createSseProgress(res, { lang });
    // The one generation pipeline (B756); this route only reports on it.
    const deck = await generateDeck(raw, {
      userName,
      targetLang: lang,
      vendor,
      targetLength,
      theme: effectiveTheme,
      titleSlideType,
      themeContext,
      slideTypes,
      ...slideTypeOffer,
      signal,
      logger,
      onOutline: progress.onOutline,
      onStatusMessage: progress.onStatusMessage,
      onGroupDone: progress.onGroupDone,
    });
    progress.finalize(deck.slides?.length || 0);

    // The per-slide "why this type", alternatives and warnings stay on the
    // saved slides; the whole-deck review grid reads them after the editor
    // loads the deck.
    const parts = generatedDeckToParts(deck, { theme, slideTypes });

    // The write step: no deck is created for a client that already left.
    signal.throwIfAborted();
    progress.save();

    const updated = await createDeckFromParts(storageScope, {
      parts,
      lang: deck.lang,
      authedUser,
      theme: effectiveTheme,
      settings: settingsFromRequest,
      notionSourcePageId,
    });

    sseWrite(res, {
      event: 'complete',
      data: {
        presentation: updated,
        sessionId,
        slideCount: updated.slides?.length || 0,
      },
    });
  } catch (e) {
    if (signal.aborted) {
      log.info(`[AI Wizard V2 Stream] ${sessionId}: cancelled by the client`);
      res.end();
      return true;
    }

    log.error('[AI Wizard V2 Stream] Error:', e);
    sseError(res, e?.message || 'Deck generation failed');
  }

  res.end();
  return true;
}
