import {
  createLlmProvider,
  createBearerHeaders,
  transformOpenAiCompatibleRequest,
  parseOpenAiCompatibleResponse,
} from '../provider-base.js';

/**
 * Request chat completion content from Mistral API
 * Mistral exposes an OpenAI-compatible chat completions endpoint.
 */
export const requestMistralChatCompletionContent = createLlmProvider({
  name: 'mistral',
  endpoint: 'https://api.mistral.ai/v1/chat/completions',
  createHeaders: createBearerHeaders,
  transformRequest: transformOpenAiCompatibleRequest,
  parseResponse: parseOpenAiCompatibleResponse,
});
