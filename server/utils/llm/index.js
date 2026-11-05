import { requestClaudeMessagesContent } from './providers/claude.js';
import { requestDeepSeekChatCompletionContent } from './providers/deepseek.js';
import { requestMistralChatCompletionContent } from './providers/mistral.js';
import { requestOpenAiChatCompletionContent } from './providers/openai.js';
import { requestOpenAiCompatChatCompletionContent } from './providers/openai-compat.js';
import { LlmError } from './error.js';
import { withDataBoundary } from './untrusted-data.js';
import { meterLlmCall } from './meter.js';

export { LlmError } from './error.js';
export { starterRequest, untrustedData } from './untrusted-data.js';
export { AiQuotaError, runWithAiAttribution } from './meter.js';

/**
 * Request one chat completion from the configured vendor and return its text.
 *
 * `signal` reaches the provider's fetch, so aborting it cancels the model call
 * (and the read of its response) instead of letting it run to completion.
 *
 * A message may carry `cache: true`: the prompt up to and including it is sent
 * unchanged on every call, so a provider with explicit prompt caching caches
 * it (Claude: a `cache_control` breakpoint). Providers that cache repeated
 * prefixes on their own (OpenAI, DeepSeek) or not at all get the same messages
 * without the marker. One prompt, every vendor; the marker only pays off when
 * the marked prefix is byte-identical across calls (B766).
 *
 * Every user message fences its content (`untrusted-data.js`) and is refused
 * without a fence; the rule that gives the fence its meaning is added here, so
 * one prompt can not forget it (DY-814).
 *
 * Every call is counted here and refused once the installation's daily
 * ceiling is reached (`meter.js`, DY-844): an {@link AiQuotaError} before
 * anything is sent.
 *
 * @param {Object} params
 * @param {Array<{role: string, content: string, cache?: boolean}>} [params.messages]
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
  messages: promptMessages = [],
  signal,
} = {}) {
  const messages = withDataBoundary(promptMessages);
  if (!PROVIDERS[vendor]) throw LlmError.unsupportedVendor(vendor);
  return meterLlmCall(() =>
    PROVIDERS[vendor]({
      apiKey,
      model,
      temperature,
      responseFormat,
      maxTokens,
      messages,
      signal,
    }),
  );
}

/**
 * The request function per vendor. Claude has no OpenAI `response_format`; its
 * provider ignores the field and relies on the prompt.
 */
const PROVIDERS = Object.freeze({
  openai: requestOpenAiChatCompletionContent,
  claude: requestClaudeMessagesContent,
  mistral: requestMistralChatCompletionContent,
  deepseek: requestDeepSeekChatCompletionContent,
  'openai-compat': requestOpenAiCompatChatCompletionContent,
});
