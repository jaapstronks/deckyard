import { serveJson } from '../../../utils/http.js';
import { getLlmStatus } from '../../../utils/llm/config.js';

/**
 * GET /api/ai/vendors — LLM vendor discovery for UI configuration.
 * @param {import('./shared.js').AiContext} ctx
 */
export async function handleAiVendors({ res }) {
  serveJson(res, 200, getLlmStatus());
  return true;
}
