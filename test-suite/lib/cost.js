/**
 * Token and cost accounting for a suite run.
 *
 * Generation cost comes from the app's LLM usage observer; the suite's own
 * calls (judge, topic extraction) report usage directly. Both land here so the
 * report can show a single spend figure per run.
 */

import { subscribeLlmUsage } from '../../server/utils/llm/usage.js';
import { PRICING } from './config.js';

const EMPTY = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  calls: 0,
};

/**
 * Compute USD cost for a token bucket.
 *
 * @param {typeof EMPTY} tokens
 * @returns {number} Cost in USD
 */
export function costOf(tokens) {
  const perMillion = (count, rate) => (count / 1_000_000) * rate;
  return (
    perMillion(tokens.inputTokens, PRICING.input) +
    perMillion(tokens.outputTokens, PRICING.output) +
    perMillion(tokens.cacheReadTokens, PRICING.cacheRead) +
    perMillion(tokens.cacheWriteTokens, PRICING.cacheWrite)
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
   * @returns {this}
   */
  attachToAppLlm() {
    if (this.unsubscribe) return this;
    this.unsubscribe = subscribeLlmUsage((event) => this.record('generation', event));
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
   * @param {string} category
   * @param {{inputTokens?:number, outputTokens?:number, cacheReadTokens?:number, cacheWriteTokens?:number}} usage
   */
  record(category, usage = {}) {
    const bucket = this.buckets.get(category) || { ...EMPTY };
    bucket.inputTokens += Number(usage.inputTokens) || 0;
    bucket.outputTokens += Number(usage.outputTokens) || 0;
    bucket.cacheReadTokens += Number(usage.cacheReadTokens) || 0;
    bucket.cacheWriteTokens += Number(usage.cacheWriteTokens) || 0;
    bucket.calls += 1;
    this.buckets.set(category, bucket);
  }

  /**
   * @returns {{byCategory: Record<string, object>, total: object, totalUsd: number}}
   */
  summary() {
    const byCategory = {};
    const total = { ...EMPTY };
    for (const [category, bucket] of this.buckets) {
      byCategory[category] = { ...bucket, usd: round(costOf(bucket)) };
      total.inputTokens += bucket.inputTokens;
      total.outputTokens += bucket.outputTokens;
      total.cacheReadTokens += bucket.cacheReadTokens;
      total.cacheWriteTokens += bucket.cacheWriteTokens;
      total.calls += bucket.calls;
    }
    return { byCategory, total, totalUsd: round(costOf(total)) };
  }
}

function round(usd) {
  return Math.round(usd * 10000) / 10000;
}
