/**
 * Token and cost accounting for a suite run.
 *
 * Generation cost comes from the app's LLM usage observer; the suite's own
 * calls (judge, topic extraction) report usage directly. Both land here so the
 * report can show a single spend figure per run.
 */

import { subscribeLlmUsage } from '../../server/utils/llm/usage.js';
import { MODEL, PRICING } from './config.js';

const EMPTY = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  calls: 0,
};

/**
 * Compute USD cost for a token bucket at a given model's rates.
 *
 * @param {typeof EMPTY} tokens
 * @param {string} model - Must exist in PRICING
 * @returns {number} Cost in USD
 * @throws when the model has no published rates, rather than silently
 *   reporting zero -- a cost report that quietly under-counts is worse than
 *   one that fails loudly.
 */
export function costOf(tokens, model) {
  const rates = PRICING[model];
  if (!rates) {
    throw new Error(
      `No pricing for model "${model}". Add it to PRICING in test-suite/lib/config.js.`
    );
  }
  const perMillion = (count, rate) => (count / 1_000_000) * rate;
  return (
    perMillion(tokens.inputTokens, rates.input) +
    perMillion(tokens.outputTokens, rates.output) +
    perMillion(tokens.cacheReadTokens, rates.cacheRead) +
    perMillion(tokens.cacheWriteTokens, rates.cacheWrite)
  );
}

/**
 * Accumulates token usage per category ('generation', 'judge', 'topics').
 */
export class CostTracker {
  constructor() {
    /** @type {Map<string, typeof EMPTY>} */
    this.buckets = new Map();
    this.unsubscribe = null;
  }

  /**
   * Start capturing generation usage emitted by the app's LLM layer.
   *
   * The event carries the model the app actually called, so cost is priced at
   * that model's rates rather than assumed.
   *
   * @returns {this}
   */
  attachToAppLlm() {
    if (this.unsubscribe) return this;
    this.unsubscribe = subscribeLlmUsage((event) =>
      this.record('generation', event, event.model)
    );
    return this;
  }

  /** Stop capturing app LLM usage. */
  detach() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
  }

  /**
   * Record one call's usage.
   *
   * Buckets are keyed by category *and* model, because a single run can drive
   * generation on one vendor while the judge stays on another, and the two are
   * priced differently.
   *
   * @param {string} category
   * @param {{inputTokens?:number, outputTokens?:number, cacheReadTokens?:number, cacheWriteTokens?:number}} usage
   * @param {string} model
   */
  record(category, usage = {}, model = MODEL) {
    const key = `${category}|${model}`;
    const bucket = this.buckets.get(key) || { ...EMPTY, category, model };
    bucket.inputTokens += Number(usage.inputTokens) || 0;
    bucket.outputTokens += Number(usage.outputTokens) || 0;
    bucket.cacheReadTokens += Number(usage.cacheReadTokens) || 0;
    bucket.cacheWriteTokens += Number(usage.cacheWriteTokens) || 0;
    bucket.calls += 1;
    this.buckets.set(key, bucket);
  }

  /**
   * @returns {{byCategory: Record<string, object>, total: object, totalUsd: number}}
   */
  summary() {
    const byCategory = {};
    const total = { ...EMPTY };
    for (const [key, bucket] of this.buckets) {
      byCategory[key] = { ...bucket, usd: round(costOf(bucket, bucket.model)) };
      total.inputTokens += bucket.inputTokens;
      total.outputTokens += bucket.outputTokens;
      total.cacheReadTokens += bucket.cacheReadTokens;
      total.cacheWriteTokens += bucket.cacheWriteTokens;
      total.calls += bucket.calls;
    }
    // Total is summed from the per-model line items; the aggregate token
    // counts span models and cannot be priced at a single rate.
    const totalUsd = Object.values(byCategory).reduce((sum, entry) => sum + entry.usd, 0);
    return { byCategory, total, totalUsd: round(totalUsd) };
  }
}

function round(usd) {
  return Math.round(usd * 10000) / 10000;
}
