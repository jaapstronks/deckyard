import {
  badRequest,
  serveJson,
  withErrorHandler,
  requireJsonBody,
} from '../../../utils/http.js';
import {
  getOptionalObject,
  getOptionalString,
} from '../../../utils/request-validators.js';
import { analyzeForCompression } from '../../../utils/ai/compress-deck.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';

/**
 * POST /api/ai/compress-deck — analyze a presentation for consolidation
 * opportunities. It answers recommendations only: removing a slide is the
 * starter's own write, never the model's (DY-812).
 * @param {import('./shared.js').AiContext} ctx
 */
export const handleAiCompressDeck = withErrorHandler(
  'ai-compress-deck',
  async ({ req, res, storageScope }) => {
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    const presentation = getOptionalObject(body, 'presentation');
    if (!presentation || !Array.isArray(presentation.slides)) {
      return badRequest(res, 'Expected { presentation: { slides: [...] } }');
    }

    const vendor = getOptionalString(body, 'vendor');
    const targetReduction =
      getOptionalString(body, 'targetReduction') || 'moderate';

    const recommendations = await analyzeForCompression(presentation, {
      targetReduction,
      vendor,
      slideTypes: await buildMergedSlideTypes(storageScope),
    });

    serveJson(res, 200, { recommendations });
    return true;
  },
);
