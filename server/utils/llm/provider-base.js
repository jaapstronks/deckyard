/**
 * Base factory for creating LLM provider request functions.
 *
 * Provides standardized fetch and error handling for LLM API requests.
 */

import { LlmError } from './error.js';
import { safeJsonParse } from '../openai/json.js';
import { emitLlmUsage } from './usage.js';

/**
 * Create an LLM provider request function with standardized error handling.
 *
 * @param {Object} config
 * @param {string} config.name - Provider name for error messages (e.g., 'openai', 'mistral')
 * @param {string} config.endpoint - API endpoint URL
 * @param {Function} config.createHeaders - (apiKey) => headers object
 * @param {Function} config.transformRequest - (params) => request body object
 * @param {Function} config.parseResponse - (bodyText) => content string
 * @param {Function} [config.parseUsage] - (bodyText) => token counts, reported
 *   to `subscribeLlmUsage` listeners. Omit for providers whose usage shape
 *   isn't mapped yet; usage is then simply not reported.
 * @returns {Function} async (params) => content string
 */
export function createLlmProvider({
  name,
  endpoint,
  createHeaders,
  transformRequest,
  parseResponse,
  parseUsage = null,
}) {
  /**
   * Make a request to the LLM provider
   * @param {Object} params - Request parameters
   * @param {string} params.apiKey - API key for the provider
   * @param {string} params.model - Model identifier
   * @param {number} [params.temperature=0.2] - Temperature setting
   * @param {Object} [params.responseFormat] - Response format (for JSON mode)
   * @param {Array} [params.messages] - Messages array
   * @param {number} [params.maxTokens] - Max tokens (provider-specific)
   * @returns {Promise<string>} - Response content
   */
  return async function request(params = {}) {
    const headers = createHeaders(params.apiKey);
    const body = transformRequest(params);

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const bodyText = await resp.text();
    if (!resp.ok) {
      throw LlmError.fromProviderFailure(name, resp.status, bodyText, params.model);
    }

    if (parseUsage) {
      const usage = parseUsage(bodyText);
      if (usage) emitLlmUsage({ vendor: name, model: params.model, ...usage });
    }

    return parseResponse(bodyText);
  };
}

/**
 * Standard headers creator for Bearer token auth (OpenAI, Mistral, DeepSeek)
 * @param {string} apiKey - API key
 * @returns {Object} Headers object
 */
export function createBearerHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Headers creator with optional Bearer token auth.
 * Skips the Authorization header when apiKey is empty/null — useful for local
 * servers like Ollama that don't require authentication.
 * @param {string|null|undefined} apiKey - API key (optional)
 * @returns {Object} Headers object
 */
export function createOptionalBearerHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

/**
 * Standard request transformer for OpenAI-compatible APIs
 * @param {Object} params - Request parameters
 * @returns {Object} Request body
 */
export function transformOpenAiCompatibleRequest({ model, temperature = 0.2, responseFormat, messages = [] }) {
  return {
    model,
    temperature,
    ...(responseFormat ? { response_format: responseFormat } : {}),
    messages,
  };
}

/**
 * Standard response parser for OpenAI-compatible APIs
 * Extracts content from choices[0].message.content
 * @param {string} bodyText - Response body text
 * @returns {string} Content string
 */
export function parseOpenAiCompatibleResponse(bodyText) {
  const parsed = safeJsonParse(bodyText);
  return parsed?.choices?.[0]?.message?.content ?? '';
}
