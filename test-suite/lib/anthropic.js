/**
 * Anthropic SDK wrapper for the suite's own model calls (judge, topic
 * extraction). Deck generation deliberately does NOT go through here -- it
 * runs on the app's own LLM layer so the suite exercises production code
 * paths. See decision D1 in PLAN.md.
 */

import Anthropic from '@anthropic-ai/sdk';

import { JUDGE_EFFORT, MODEL } from './config.js';

let client = null;

/** @returns {Anthropic} Lazily constructed shared client. */
export function getClient() {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Run the suite with: node --env-file=.env ...'
    );
  }
  client = new Anthropic({ apiKey });
  return client;
}

/**
 * Ask the model for a JSON object matching a schema.
 *
 * Uses `output_config.format` so the response is schema-valid by construction
 * -- no brittle JSON extraction from prose. Adaptive thinking is on; the model
 * takes no temperature, so effort is the only depth knob.
 *
 * @param {Object} options
 * @param {string} options.system - System prompt (cached when large enough)
 * @param {string} options.largeContext - Large context for the call (typically
 *   the source document).
 * @param {boolean} [options.cacheContext] - Put a cache breakpoint after
 *   largeContext. Only worth it when the SAME system prompt and context will
 *   be sent again within the cache TTL: a cache write costs 1.25x input, so
 *   caching a single-use prefix is a pure loss. Topic extraction and judging
 *   use different system prompts, so they cannot share a cached prefix.
 * @param {string} options.prompt - The per-call request
 * @param {object} options.schema - JSON schema for the response
 * @param {string} [options.effort]
 * @param {number} [options.maxTokens]
 * @param {(usage: object) => void} [options.onUsage] - Receives normalized usage
 * @returns {Promise<object>} Parsed, schema-valid object
 */
export async function requestJson({
  system,
  largeContext = '',
  cacheContext = false,
  prompt,
  schema,
  effort = JUDGE_EFFORT,
  maxTokens = 8000,
  onUsage = null,
}) {
  const content = [];
  if (largeContext) {
    content.push({
      type: 'text',
      text: largeContext,
      ...(cacheContext ? { cache_control: { type: 'ephemeral' } } : {}),
    });
  }
  content.push({ type: 'text', text: prompt });

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });

  if (onUsage) onUsage(normalizeSdkUsage(response.usage));

  if (response.stop_reason === 'refusal') {
    throw new Error(`Model refused the request (${response.stop_details?.category ?? 'unknown'})`);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Response hit max_tokens (${maxTokens}); output is truncated.`);
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Schema-valid JSON expected but parse failed: ${err.message}`);
  }
}

/**
 * Map SDK usage onto the same shape the app's usage observer emits, so both
 * feed one cost tracker.
 *
 * @param {object} usage
 */
export function normalizeSdkUsage(usage = {}) {
  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    cacheWriteTokens: usage.cache_creation_input_tokens || 0,
  };
}
