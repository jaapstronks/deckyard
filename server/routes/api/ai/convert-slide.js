import { badRequest, json, serveJson } from '../../../utils/http.js';
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
export async function handleAiConvertSlide({ req, res }) {
  const body = await json(req);
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

  try {
    const converted = await convertSlideWithAi(slide, toType, {
      vendor,
      lang,
    });
    serveJson(res, 200, { slide: converted });
  } catch (e) {
    const statusCode = e?.statusCode || 500;
    serveJson(res, statusCode, { error: e?.message || 'Conversion failed' });
  }
  return true;
}
