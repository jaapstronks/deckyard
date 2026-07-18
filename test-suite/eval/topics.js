/**
 * Key-topic extraction from a source document.
 *
 * Coverage ("what share of the source's key topics made it into the deck?")
 * needs a topic list that is independent of the deck, otherwise the metric
 * grades the deck against itself. So topics are extracted from the source in a
 * separate step, cached per source, and reused across every run and repeat.
 */

import { requestJson } from '../lib/anthropic.js';
import { cacheKey, withCache } from '../lib/cache.js';
import { MODEL } from '../lib/config.js';

const SYSTEM = `You extract the key topics a presentation about a source document would have to cover.

You are given a source document. Identify the topics that a competent human
presenter would consider essential -- the points whose absence would make a
deck about this document incomplete.

Rules:
- Between 5 and 12 topics. Fewer for short sources, more for long ones.
- Each topic is a short noun phrase (max 8 words), in the source's own language.
- Rank by importance: the most essential topic first.
- Topics must be substantive content, not document furniture (no "introduction",
  "conclusion", "table of contents", "about the authors").
- Topics must be distinct; do not restate one topic in two ways.`;

const SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          importance: { type: 'string', enum: ['essential', 'important', 'supporting'] },
          evidence: { type: 'string', description: 'Short quote or figure from the source' },
        },
        required: ['topic', 'importance', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

const EXTRACTION_VERSION = 'topics-v1';

/**
 * Extract (and cache) the key topics of a source document.
 *
 * @param {Object} options
 * @param {string} options.caseId
 * @param {string} options.sourceText
 * @param {(usage: object) => void} [options.onUsage]
 * @param {boolean} [options.refresh] - Bypass the cache
 * @returns {Promise<{topics: {topic: string, importance: string, evidence: string}[], cached: boolean}>}
 */
export async function extractKeyTopics({ caseId, sourceText, onUsage = null, refresh = false }) {
  const key = cacheKey(EXTRACTION_VERSION, MODEL, SYSTEM, sourceText);

  const { value, cached } = await withCache(
    'topics',
    key,
    async () =>
      requestJson({
        system: SYSTEM,
        cacheableContext: `<source_document case="${caseId}">\n${sourceText}\n</source_document>`,
        prompt: 'Extract the key topics of the source document above.',
        schema: SCHEMA,
        maxTokens: 4000,
        onUsage,
      }),
    { skip: refresh }
  );

  return { topics: value.topics || [], cached };
}
