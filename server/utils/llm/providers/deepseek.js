import {
  createLlmProvider,
  createBearerHeaders,
  transformOpenAiCompatibleRequest,
  parseOpenAiCompatibleResponse,
} from '../provider-base.js';

/**
 * Request chat completion content from DeepSeek API.
 * DeepSeek exposes an OpenAI-compatible chat completions endpoint.
 */
export const requestDeepSeekChatCompletionContent = createLlmProvider({
  name: 'deepseek',
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  createHeaders: createBearerHeaders,
  transformRequest: transformOpenAiCompatibleRequest,
  parseResponse: parseOpenAiCompatibleResponse,
});
