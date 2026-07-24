import { badRequest, json, serveJson, withErrorHandler } from '../../../utils/http.js';
import {
  getOptionalObject,
  getOptionalString,
  getBoolean,
} from '../../../utils/request-validators.js';
import { analyzeForCompression, applyCompression } from '../../../utils/ai/compress-deck.js';

/**
 * POST /api/ai/compress-deck — analyze a presentation for consolidation
 * opportunities (and optionally apply them).
 * @param {import('./shared.js').AiContext} ctx
 */
export const handleAiCompressDeck = withErrorHandler('ai-compress-deck', async ({ req, res }) => {
  const body = await json(req);
  const presentation = getOptionalObject(body, 'presentation');
  if (!presentation || !Array.isArray(presentation.slides)) {
    return badRequest(res, 'Expected { presentation: { slides: [...] } }');
  }

  const vendor = getOptionalString(body, 'vendor');
  const targetReduction = getOptionalString(body, 'targetReduction') || 'moderate';
  const applyChanges = getBoolean(body, 'applyChanges', false);

  const recommendations = await analyzeForCompression(presentation, {
    targetReduction,
    vendor,
  });

  if (
    applyChanges &&
    (recommendations.merges.length > 0 || recommendations.removals.length > 0)
  ) {
    const compressed = applyCompression(presentation, recommendations);
    serveJson(res, 200, {
      recommendations,
      presentation: compressed,
      applied: true,
    });
  } else {
    serveJson(res, 200, {
      recommendations,
      applied: false,
    });
  }
  return true;
});
