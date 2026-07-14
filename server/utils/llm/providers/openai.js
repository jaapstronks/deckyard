import {
  createLlmProvider,
  createBearerHeaders,
  transformOpenAiCompatibleRequest,
  parseOpenAiCompatibleResponse,
} from '../provider-base.js';

/**
 * Request chat completion content from OpenAI API
 */
export const requestOpenAiChatCompletionContent = createLlmProvider({
  name: 'openai',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  createHeaders: createBearerHeaders,
  transformRequest: transformOpenAiCompatibleRequest,
  parseResponse: parseOpenAiCompatibleResponse,
});
