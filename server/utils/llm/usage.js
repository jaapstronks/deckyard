/**
 * Observer for LLM token usage.
 *
 * Providers report per-call token counts here; interested callers subscribe.
 * With no subscribers this is a no-op, so normal request paths are unaffected.
 *
 * This exists because the provider layer returns only the completion string —
 * usage is discarded. The AI test suite needs per-run token counts to report
 * API cost, and cost reporting is useful beyond it.
 */

/** @type {Set<(event: LlmUsageEvent) => void>} */
const listeners = new Set();

/**
 * @typedef {Object} LlmUsageEvent
 * @property {string} vendor - Provider name ('claude', 'openai', ...)
 * @property {string} model - Model identifier the call ran against
 * @property {number} inputTokens - Uncached prompt tokens
 * @property {number} outputTokens - Generated tokens
 * @property {number} cacheReadTokens - Prompt tokens served from cache
 * @property {number} cacheWriteTokens - Prompt tokens written to cache
 */

/**
 * Subscribe to usage events.
 *
 * @param {(event: LlmUsageEvent) => void} listener
 * @returns {() => void} Unsubscribe function
 */
export function subscribeLlmUsage(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Report a usage event. Listener errors are swallowed: usage accounting must
 * never break the request that produced it.
 *
 * @param {LlmUsageEvent} event
 */
export function emitLlmUsage(event) {
  if (!listeners.size || !event) return;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.warn('[llm-usage] listener failed:', err?.message);
    }
  }
}

/**
 * Normalize a provider's raw usage object into an LlmUsageEvent payload.
 * Unknown or missing fields become 0 so consumers can always sum safely.
 *
 * @param {Object} raw - Provider-specific usage object
 * @param {Object} [fieldMap] - Maps event fields to raw keys
 * @returns {Omit<LlmUsageEvent, 'vendor'|'model'>}
 */
export function normalizeUsage(raw, fieldMap = {}) {
  const {
    inputTokens = 'input_tokens',
    outputTokens = 'output_tokens',
    cacheReadTokens = 'cache_read_input_tokens',
    cacheWriteTokens = 'cache_creation_input_tokens',
  } = fieldMap;
  const num = (key) => {
    const value = Number(raw?.[key]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    inputTokens: num(inputTokens),
    outputTokens: num(outputTokens),
    cacheReadTokens: num(cacheReadTokens),
    cacheWriteTokens: num(cacheWriteTokens),
  };
}
