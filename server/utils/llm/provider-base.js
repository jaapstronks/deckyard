/**
 * Base factory for creating LLM provider request functions.
 *
 * Provides standardized fetch and error handling for LLM API requests.
 */

import { LlmError } from './error.js';
import { safeJsonParse } from '../openai/json.js';

/**
 * Create an LLM provider request function with standardized error handling.
 *
 * @param {Object} config
 * @param {string} config.name - Provider name for error messages (e.g., 'openai', 'mistral')
 * @param {string} config.endpoint - API endpoint URL
 * @param {Function} config.createHeaders - (apiKey) => headers object
 * @param {Function} config.transformRequest - (params) => request body object
 * @param {Function} config.parseResponse - (bodyText) => content string
 * @returns {Function} async (params) => content string
 */
export function createLlmProvider({ name, endpoint, createHeaders, transformRequest, parseResponse }) {
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
    ...(supportsSampling(model) ? { temperature } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    messages,
  };
}

/**
 * Whether a model accepts a non-default `temperature`.
 *
 * Newer OpenAI reasoning models reject it outright — gpt-5.5 answers a
 * non-default value with `400 unsupported_value`, which fails the whole
 * request rather than degrading. Older models (gpt-5.2 and earlier, gpt-4x)
 * still accept it, so temperature is kept for them rather than changing
 * behaviour for existing deployments.
 *
 * Mirrors the same guard in the Claude provider, where Opus 4.7+ removed
 * sampling parameters for the same reason.
 *
 * @param {string} model - Model identifier
 * @returns {boolean}
 */
function supportsSampling(model) {
  // gpt-5.5 and up, any gpt-6+, and the o-series reasoning models.
  return !/^(gpt-5\.(?:[5-9]|\d{2})|gpt-[6-9]|o[1-9])/i.test(String(model || ''));
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
