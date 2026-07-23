import { badRequest, json, serveJson } from '../../../utils/http.js';
import { getAiParams, getBoolean } from '../../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { generateDeckV2 } from '../../../utils/ai/index.js';
import { getDisplayNameForUser } from '../../../utils/user-name.js';
import { sandboxDefaultThemeId, sandboxEnabled } from '../../../config/sandbox.js';
import {
  log,
  loadSlideTypeContext,
  loadAiThemeContext,
  reattachAiMeta,
  createPresentationWithI18n,
} from './shared.js';

/**
 * POST /api/ai/wizard-v2 — two-phase deck generation with better slide type
 * selection (for testing/comparison against the v1 wizard).
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiWizardV2({ repoRoot, req, res, authedUser }) {
  const body = await json(req);
  const {
    raw,
    vendor,
    lang,
    theme: themeFromRequest,
    settings: settingsFromRequest,
  } = getAiParams(body);
  if (!raw.trim()) return badRequest(res, 'Expected { raw: "..." }');
  const enableLogging = getBoolean(body, 'enableLogging', true);

  const userName = getDisplayNameForUser(authedUser);
  const effectiveTheme =
    themeFromRequest || (sandboxEnabled() ? sandboxDefaultThemeId() : 'default');

  // Load theme to get the correct title slide type and theme context for AI
  const { titleSlideType, themeContext } = await loadAiThemeContext(
    repoRoot,
    effectiveTheme
  );

  const slideTypeCtx = await loadSlideTypeContext(authedUser);
  try {
    const deck = await generateDeckV2(raw, {
      userName,
      targetLang: lang,
      vendor,
      theme: effectiveTheme,
      titleSlideType,
      enableLogging,
      disabledSlideTypes: slideTypeCtx.disabled,
      customSlideTypes: slideTypeCtx.custom,
      themeContext,
    });

    const parts = deckToPresentationParts(deck);
    reattachAiMeta(parts.slides, deck.slides);

    const updated = await createPresentationWithI18n(repoRoot, {
      parts,
      lang,
      authedUser,
      theme: effectiveTheme,
      settings: settingsFromRequest,
    });

    // Include generation metadata for debugging
    serveJson(res, 201, {
      ...updated,
      _generationMeta: deck._generationMeta,
    });
  } catch (e) {
    log.error('[AI Wizard V2] Error:', e);
    const statusCode = e?.statusCode || 500;
    serveJson(res, statusCode, {
      error: e?.message || 'Deck generation failed',
      details: e?.rawResponse?.slice(0, 1000),
    });
  }
  return true;
}
