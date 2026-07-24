import { badRequest, json, serveJson, withErrorHandler } from '../../../utils/http.js';
import {
  getOptionalObject,
  getOptionalString,
  getTrimmedString,
  getBoolean,
  getLang,
} from '../../../utils/request-validators.js';
import { loadSlideTypeContext } from './shared.js';

/**
 * POST /api/ai/iterate — apply a natural-language command to a deck or a single
 * slide, returning the plan and (optionally) the updated presentation.
 * @param {import('./shared.js').AiContext} ctx
 */
export const handleAiIterate = withErrorHandler('ai-iterate', async ({ req, res, authedUser }) => {
  const body = await json(req);
  const presentation = getOptionalObject(body, 'presentation');
  if (!presentation || !Array.isArray(presentation.slides)) {
    return badRequest(
      res,
      'Expected { presentation: { slides: [...] }, command: "..." }'
    );
  }

  const command = getTrimmedString(body, 'command');
  if (!command) {
    return badRequest(res, 'Expected { command: "make this punchier" }');
  }

  const vendor = getOptionalString(body, 'vendor');
  const lang = getLang(body) || 'en';
  const applyChanges = getBoolean(body, 'applyChanges', true);

  // Per-slide refine sends the index of the slide being edited so the LLM
  // works on that slide instead of the whole deck (validated in the util).
  const rawIndex = Number(body?.currentSlideIndex);
  const currentSlideIndex = Number.isInteger(rawIndex) ? rawIndex : null;

  const slideTypeCtx = await loadSlideTypeContext(authedUser);

  const { iteratePresentation } = await import('../../../utils/ai/iterate-deck.js');
  const {
    deck: newDeck,
    plan,
    targetSlideIndex,
  } = await iteratePresentation(presentation, command, {
    lang,
    vendor,
    currentSlideIndex,
    disabledSlideTypes: slideTypeCtx.disabled,
    customSlideTypes: slideTypeCtx.custom,
  });

  serveJson(res, 200, {
    plan,
    presentation: applyChanges ? newDeck : null,
    applied: applyChanges,
    targetSlideIndex,
  });
  return true;
});
