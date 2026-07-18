/**
 * LLM-as-judge scoring of a generated deck.
 *
 * Scores are the headline number, but the rationales are what the iteration
 * loop in phase 4 actually consumes -- so the prompt insists on concrete,
 * actionable criticism tied to specific slides rather than a grade summary.
 */

import { requestJson } from '../lib/anthropic.js';
import { cacheKey, withCache } from '../lib/cache.js';
import { MODEL, REFERENCE_DIMENSION, RUBRIC_DIMENSIONS } from '../lib/config.js';
import { extractSlideText } from './metrics.js';

const JUDGE_VERSION = 'judge-v1';

const SYSTEM = `You evaluate AI-generated presentation decks against their source material.

You are a demanding but fair reviewer. Your scores drive automated prompt
tuning, so they must be discriminating: if every deck scores 4, the scores are
useless. Reserve 5 for decks you would present essentially unchanged, and use
1-2 freely where a dimension genuinely fails.

Score each dimension 1-5:

- coverage: are the source's most important points present? Penalise a deck
  that covers trivia while omitting the headline finding. Judge against the
  source, not against deck length.
- structure: is there a logical arc (opening -> body -> close), sensible
  ordering, and grouping that reflects how the material actually decomposes?
  Penalise arbitrary ordering and a table-of-contents feel.
- slideEconomy: is the amount of text per slide right for spoken presentation?
  Penalise walls of text, sentences where a phrase would do, and slides so
  sparse they say nothing. This dimension is about the text ON the slides.
- faithfulness: is everything traceable to the source? Penalise invented
  figures, overstated claims, and subtly wrong attributions. A single
  fabricated number should cap this dimension at 2.
- presentability: could a human present this after light editing? Consider
  whether titles carry meaning, whether slides work standalone, and whether
  the register suits the material.

Rules for rationales:
- Every rationale must cite specific evidence: a slide number, a title, or a
  quoted phrase. "Good coverage" is a useless rationale; "slide 4 omits the
  20% victim rate that the source leads with" is a useful one.
- Say what is wrong AND what the generator should have done instead. The
  rationale is read by someone editing a generation prompt.
- Be concise: 1-3 sentences per dimension.

Also return:
- topLevelIssue: the single most valuable fix for this deck, phrased as an
  instruction to whoever maintains the generation prompts.
- missingTopics: key topics from the provided list that the deck fails to cover.`;

/**
 * Build the response schema, adding the reference dimension for category A.
 *
 * @param {boolean} withReference
 */
function buildSchema(withReference) {
  const dimensions = [...RUBRIC_DIMENSIONS];
  if (withReference) dimensions.push(REFERENCE_DIMENSION);

  const scores = {};
  for (const dimension of dimensions) {
    scores[dimension] = {
      type: 'object',
      properties: {
        score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
        rationale: { type: 'string' },
      },
      required: ['score', 'rationale'],
      additionalProperties: false,
    };
  }

  return {
    type: 'object',
    properties: {
      scores: {
        type: 'object',
        properties: scores,
        required: dimensions,
        additionalProperties: false,
      },
      topLevelIssue: { type: 'string' },
      missingTopics: { type: 'array', items: { type: 'string' } },
    },
    required: ['scores', 'topLevelIssue', 'missingTopics'],
    additionalProperties: false,
  };
}

/**
 * Render a deck as compact text for the judge. Sending raw deck JSON would
 * spend tokens on ids and styling the judge must not grade.
 *
 * @param {object} deck
 * @returns {string}
 */
export function renderDeckForJudge(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  return slides
    .map((slide, index) => {
      const { title, body } = extractSlideText(slide);
      const lines = [`Slide ${index + 1} [${slide.type}]`];
      if (title) lines.push(`Title: ${title}`);
      if (body) lines.push(body);
      if (slide.notes) lines.push(`(Presenter notes: ${slide.notes})`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Render a parsed human reference deck for comparison.
 *
 * @param {{slides: {title: string, text: string}[]}} reference
 * @returns {string}
 */
function renderReference(reference) {
  return (reference?.slides || [])
    .map((slide, index) =>
      [`Slide ${index + 1}`, slide.title && `Title: ${slide.title}`, slide.text]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');
}

/**
 * Judge one generated deck.
 *
 * @param {Object} options
 * @param {import('../lib/cases.js').CaseManifest} options.testCase
 * @param {string} options.sourceText
 * @param {object} options.deck
 * @param {{topic: string}[]} options.topics
 * @param {object|null} [options.referenceDeck]
 * @param {boolean} [options.cacheContext] - Worth enabling only when the same
 *   case is judged more than once in a run (`--repeat`), since a cache write
 *   costs more than a plain read of the same tokens.
 * @param {(usage: object) => void} [options.onUsage]
 * @param {boolean} [options.refresh]
 * @returns {Promise<{verdict: object, cached: boolean}>}
 */
export async function judgeDeck({
  testCase,
  sourceText,
  deck,
  topics,
  referenceDeck = null,
  cacheContext = false,
  onUsage = null,
  refresh = false,
}) {
  const withReference = Boolean(referenceDeck?.slides?.length);
  const schema = buildSchema(withReference);
  const deckText = renderDeckForJudge(deck);
  const topicList = topics.map((t, i) => `${i + 1}. ${t.topic} (${t.importance})`).join('\n');

  // The source is the large, stable part of the prompt and is identical across
  // repeats of a case, so it is what a cache breakpoint would cover.
  const context = `<source_document case="${testCase.id}">\n${sourceText}\n</source_document>`;

  const promptParts = [
    `<key_topics>\n${topicList}\n</key_topics>`,
    `<generated_deck>\n${deckText}\n</generated_deck>`,
  ];

  if (withReference) {
    promptParts.push(
      `<human_reference_deck>\n${renderReference(referenceDeck)}\n</human_reference_deck>`,
      'A human-made deck about the same source is included above. In addition to the ' +
        'other dimensions, score humanLikeness: how close does the generated deck come ' +
        'to the human deck in the choices it makes -- what to include, what to leave ' +
        'out, how to sequence it, and how much text to put on a slide? Do not reward ' +
        'mere similarity of wording; reward similarity of editorial judgement.'
    );
  }

  promptParts.push(
    'Score the generated deck against the source document. Return only the JSON object.'
  );

  const prompt = promptParts.join('\n\n');
  const key = cacheKey(JUDGE_VERSION, MODEL, SYSTEM, context, prompt);

  const { value, cached } = await withCache(
    'judge',
    key,
    async () =>
      requestJson({
        system: SYSTEM,
        largeContext: context,
        cacheContext,
        prompt,
        schema,
        maxTokens: 8000,
        onUsage,
      }),
    { skip: refresh }
  );

  return { verdict: value, cached };
}

/**
 * Mean score across dimensions.
 *
 * @param {object} scores
 * @returns {number}
 */
export function meanScore(scores = {}) {
  const values = Object.values(scores)
    .map((entry) => entry?.score)
    .filter((n) => Number.isFinite(n));
  if (!values.length) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}
