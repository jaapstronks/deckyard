import { requestClaudeMessagesContent } from './providers/claude.js';
import { requestDeepSeekChatCompletionContent } from './providers/deepseek.js';
import { requestMistralChatCompletionContent } from './providers/mistral.js';
import { requestOpenAiChatCompletionContent } from './providers/openai.js';
import { requestOpenAiCompatChatCompletionContent } from './providers/openai-compat.js';
import { LlmError } from './error.js';

export { LlmError } from './error.js';

/**
 * Request one chat completion from the configured vendor and return its text.
 *
 * `signal` reaches the provider's fetch, so aborting it cancels the model call
 * (and the read of its response) instead of letting it run to completion.
 *
 * @param {Object} params
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<string>}
 */
export async function requestChatCompletionContent({
  vendor,
  apiKey,
  model,
  temperature = 0.2,
  responseFormat = null,
  maxTokens = 4096,
  messages = [],
  signal,
} = {}) {
  if (vendor === 'openai') {
    return await requestOpenAiChatCompletionContent({
      apiKey,
      model,
      temperature,
      responseFormat,
      maxTokens,
      messages,
      signal,
    });
  }
  if (vendor === 'claude') {
    // Claude doesn't support OpenAI's response_format; rely on the prompt.
    return await requestClaudeMessagesContent({
      apiKey,
      model,
      temperature,
      maxTokens,
      messages,
      signal,
    });
  }
  if (vendor === 'mistral') {
    return await requestMistralChatCompletionContent({
      apiKey,
      model,
      temperature,
      responseFormat,
      maxTokens,
      messages,
      signal,
    });
  }
  if (vendor === 'deepseek') {
    return await requestDeepSeekChatCompletionContent({
      apiKey,
      model,
      temperature,
      responseFormat,
      maxTokens,
      messages,
      signal,
    });
  }
  if (vendor === 'openai-compat') {
    return await requestOpenAiCompatChatCompletionContent({
      apiKey,
      model,
      temperature,
      responseFormat,
      maxTokens,
      messages,
      signal,
    });
  }

  throw LlmError.unsupportedVendor(vendor);
}
