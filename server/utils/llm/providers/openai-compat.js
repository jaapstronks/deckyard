import {
  createOptionalBearerHeaders,
  transformOpenAiCompatibleRequest,
  parseOpenAiCompatibleResponse,
} from '../provider-base.js';
import { LlmError } from '../error.js';

/**
 * Request chat completion content from any OpenAI-compatible endpoint.
 *
 * Unlike the other providers the endpoint is read from the environment on every
 * call so it can be changed at runtime without restarting the server.
 *
 * Works with Ollama, Together AI, Fireworks, Groq, vLLM, and any service that
 * implements the OpenAI `/v1/chat/completions` contract.
 */
export async function requestOpenAiCompatChatCompletionContent(params = {}) {
  const endpoint = process.env.OPENAI_COMPAT_ENDPOINT?.trim();
  if (!endpoint) {
    const err = new Error('OPENAI_COMPAT_ENDPOINT is not set in environment.');
    err.statusCode = 400;
    throw err;
  }

  const headers = createOptionalBearerHeaders(params.apiKey);
  const body = transformOpenAiCompatibleRequest(params);

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const bodyText = await resp.text();
  if (!resp.ok) {
    throw LlmError.fromProviderFailure('openai-compat', resp.status, bodyText, params.model);
  }

  return parseOpenAiCompatibleResponse(bodyText);
}
