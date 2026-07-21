/**
 * AI prompt seam — base-then-overlay resolver.
 *
 * The AI generation *mechanism* (builders, schemas, the `llm/` transport) lives
 * in the OSS repo. The tuned prompt *content* is extracted into `./base/` and
 * resolved here against optional fork overrides from `custom/ai/prompts.js`.
 *
 * Pipeline code imports the resolved `prompts` object and calls builders by
 * name — `prompts.buildPhase1SystemPrompt({ ... })` — without knowing or caring
 * whether the base or a fork override answered.
 *
 * Resolution happens once at module load via top-level await, so `prompts` is a
 * plain synchronous object for every consumer.
 */

import * as base from './base/index.js';
import { loadCustomPromptOverrides } from './custom-loader.js';

/**
 * Merge fork overrides onto the base builders (custom wins per name).
 *
 * Pure and side-effect free — exported for tests. Only keys present in `base`
 * and whose override is a function are applied; anything else keeps the base.
 *
 * @param {Record<string, Function>} baseBuilders
 * @param {Record<string, Function>} overrides
 * @returns {Record<string, Function>}
 */
export function resolvePrompts(baseBuilders, overrides = {}) {
  const resolved = { ...baseBuilders };
  for (const [name, fn] of Object.entries(overrides || {})) {
    if (typeof fn === 'function' && name in baseBuilders) {
      resolved[name] = fn;
    }
  }
  return resolved;
}

/** The set of builder names a fork is allowed to override. */
export const BASE_PROMPT_NAMES = Object.freeze(Object.keys(base));

const overrides = await loadCustomPromptOverrides({ knownBuilders: new Set(BASE_PROMPT_NAMES) });

/**
 * Resolved prompt builders: base copy overlaid with any fork overrides.
 * @type {Readonly<Record<string, Function>>}
 */
export const prompts = Object.freeze(resolvePrompts(base, overrides));
