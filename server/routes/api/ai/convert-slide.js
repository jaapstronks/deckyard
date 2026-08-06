import { badRequest, serveJson, withErrorHandler, requireJsonBody } from '../../../utils/http.js';
import {
  getOptionalObject,
  getOptionalString,
  getTrimmedString,
  getLang,
} from '../../../utils/request-validators.js';
import { convertSlideWithAi } from '../../../utils/ai.js';

/**
 * POST /api/ai/convert-slide — convert a slide to a different type using AI.
 * @param {import('./shared.js').AiContext} ctx
 */
export const handleAiConvertSlide = withErrorHandler('ai-convert-slide', async ({ req, res }) => {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const slide = getOptionalObject(body, 'slide');
  const toType = getTrimmedString(body, 'toType');
  if (!slide) {
    return badRequest(res, 'Expected { slide: {...}, toType: "..." }');
  }
  if (!toType) {
    return badRequest(res, 'Expected { toType: "..." }');
  }

  const vendor = getOptionalString(body, 'vendor');
  const lang = getLang(body) || 'nl';

  const converted = await convertSlideWithAi(slide, toType, {
    vendor,
    lang,
  });
  serveJson(res, 200, { slide: converted });
  return true;
});
