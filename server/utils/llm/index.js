import { requestClaudeMessagesContent } from './providers/claude.js';
import { requestDeepSeekChatCompletionContent } from './providers/deepseek.js';
import { requestMistralChatCompletionContent } from './providers/mistral.js';
import { requestOpenAiChatCompletionContent } from './providers/openai.js';
import { requestOpenAiCompatChatCompletionContent } from './providers/openai-compat.js';
import { LlmError } from './error.js';

export { LlmError } from './error.js';

export async function requestChatCompletionContent({
  vendor,
  apiKey,
  model,
  temperature = 0.2,
  responseFormat = null,
  maxTokens = 4096,
  messages = [],
} = {}) {
  if (vendor === 'openai') {
    return await requestOpenAiChatCompletionContent({
      apiKey,
      model,
      temperature,
      responseFormat,
      messages,
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
    });
  }
  if (vendor === 'mistral') {
    return await requestMistralChatCompletionContent({
      apiKey,
      model,
      temperature,
      responseFormat,
      messages,
    });
  }
  if (vendor === 'deepseek') {
    return await requestDeepSeekChatCompletionContent({
      apiKey,
      model,
      temperature,
      responseFormat,
      messages,
    });
  }
  if (vendor === 'openai-compat') {
    return await requestOpenAiCompatChatCompletionContent({
      apiKey,
      model,
      temperature,
      responseFormat,
      messages,
    });
  }

  throw LlmError.unsupportedVendor(vendor);
}
