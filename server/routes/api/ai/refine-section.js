import { badRequest, json, serveJson, withErrorHandler } from '../../../utils/http.js';
import {
  getOptionalObject,
  getOptionalString,
  getTrimmedString,
  getLang,
} from '../../../utils/request-validators.js';
import { deckToPresentationParts } from '../../../../shared/slide-types.js';
import { validateAndFixRefinedSlides } from '../../../utils/ai/validate-slides.js';
import { refineSectionWithAi } from '../../../utils/ai/refine-section.js';
import { loadSlideTypeContext } from './shared.js';

/**
 * POST /api/ai/refine-section — revise a contiguous range of slides from user
 * feedback (whole-deck review grid's multi-select "Adjust section" action).
 * @param {import('./shared.js').AiContext} ctx
 */
export const handleAiRefineSection = withErrorHandler('ai-refine-section', async ({ req, res, authedUser }) => {
  const body = await json(req);
  const presentation = getOptionalObject(body, 'presentation');
  if (!presentation || !Array.isArray(presentation.slides)) {
    return badRequest(
      res,
      'Expected { presentation: { slides: [...] }, slideIds: [...], feedback: "..." }'
    );
  }
  const slideIds = Array.isArray(body?.slideIds)
    ? body.slideIds.filter((x) => typeof x === 'string' && x)
    : [];
  if (!slideIds.length) return badRequest(res, 'Expected non-empty slideIds array.');
  const feedback = getTrimmedString(body, 'feedback');
  if (!feedback) return badRequest(res, 'Expected { feedback: "..." }');

  // The revision replaces a contiguous range: span from the first to the
  // last selected slide (gaps in the selection are included in the section).
  const wanted = new Set(slideIds);
  const indices = presentation.slides
    .map((s, i) => (s?.id && wanted.has(s.id) ? i : -1))
    .filter((i) => i >= 0);
  if (!indices.length) {
    return badRequest(res, 'None of the given slideIds exist in the presentation.');
  }
  const start = Math.min(...indices);
  const end = Math.max(...indices);

  const vendor = getOptionalString(body, 'vendor');
  const lang = getLang(body);
  const slideTypeCtx = await loadSlideTypeContext(authedUser);

  const {
    slides: revisedRaw,
    rationale,
    review,
  } = await refineSectionWithAi(presentation, {
    start,
    end,
    feedback,
    targetLang: lang,
    vendor,
    disabledSlideTypes: slideTypeCtx.disabled,
    customSlideTypes: slideTypeCtx.custom,
  });

  // Normalize so ids exist and content matches schemas, then re-attach the
  // per-slide "why" (normalization strips unknown keys).
  const parts = deckToPresentationParts(revisedRaw);
  let slides = Array.isArray(parts?.slides) ? parts.slides : [];
  slides = validateAndFixRefinedSlides(slides);
  slides.forEach((s, i) => {
    if (review?.[i]?.why) s._aiReasoning = review[i].why;
  });

  serveJson(res, 200, { slides, rationale, range: { start, end } });
  return true;
});
