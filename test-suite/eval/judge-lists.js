/**
 * LLM-as-judge for one claim: a list says its items are alike.
 *
 * `listFidelity` (metrics.js) checks the lists a case declares up front, so it
 * cannot see a list nobody declared. The likeliest such list is a summary
 * dressed as one: an opening slide whose items are a goal, a status and a role.
 * Whether items are of one kind is a judgement, not a keyword match, hence a
 * judge (DY-800, the follow-up to the acceptance gate of B596).
 *
 * The source stays out of the prompt on purpose. Kinship can be read from the
 * list itself, and one small call per deck keeps this cheap enough to run on
 * every judged repeat. It is reported apart from the rubric, so it does not
 * move the scale of the existing scores.
 */

import { requestJson } from '../lib/anthropic.js';
import { cacheKey, withCache } from '../lib/cache.js';
import { MODEL } from '../lib/config.js';
import { extractSlideText, slideItemGroups } from './metrics.js';

const LIST_JUDGE_VERSION = 'list-kinship-judge-v1';

/** Two items cannot make up a mix worth reporting: they are a comparison. */
const MIN_ITEMS = 3;

const SYSTEM = `You check one claim in the lists of a presentation deck: a list claims its items are alike.

A heading with N items says: there are N things of the kind the heading names,
and each item is one of them. The list form prepares the reader for that. When
the claim is false, the reader has to reinterpret the slide while reading it.

Mark a list as mixed (alike: false) when its items answer different questions.
The typical cases:
- a summary dressed as a list: a goal, a status, a role and a scope side by side;
- a remark about the list posing as an item: an implication, an ambition or a
  caveat next to the things the list enumerates;
- one item of another kind among otherwise parallel items, such as a research
  question among decisions.

Do not mark a list as mixed for these:
- items of one kind at different levels of detail, or phrased unevenly;
- the steps of one sequence, the metrics of one report, the parts of one whole;
- items merged or reordered from the source: you are not comparing to a source.

Be discriminating: a list passes only if you could name one kind that every item
is an instance of, without stretching it into "aspects of the topic". "Aspects
of the topic" is the mark of a mixed list, not a kind.

For each list, return its id, whether the items are alike, the kinds you see,
the items that do not belong (empty when the list is mixed through and through,
or alike), and one sentence saying what the generator should have done instead.`;

const SCHEMA = {
  type: 'object',
  properties: {
    lists: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          alike: { type: 'boolean' },
          kinds: { type: 'array', items: { type: 'string' } },
          strays: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
        required: ['id', 'alike', 'kinds', 'strays', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['lists'],
  additionalProperties: false,
};

/**
 * Every item collection in a deck that makes the claim, in deck order.
 *
 * @param {object} deck
 * @returns {{id: number, slide: number, type: string, title: string, subheading: string, items: string[]}[]}
 */
export function deckItemLists(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const lists = slides.flatMap((slide, index) =>
    slideItemGroups(slide)
      .filter((items) => items.length >= MIN_ITEMS)
      .map((items) => ({
        slide: index + 1,
        type: slide.type,
        title: extractSlideText(slide).title,
        subheading:
          typeof slide.content?.subheading === 'string'
            ? slide.content.subheading
            : '',
        items,
      })),
  );
  return lists.map((list, index) => ({ id: index + 1, ...list }));
}

/**
 * Render the lists for the judge.
 *
 * @param {ReturnType<typeof deckItemLists>} lists
 * @returns {string}
 */
export function renderListsForJudge(lists) {
  return lists
    .map((list) =>
      [
        `List ${list.id} (slide ${list.slide}, ${list.type})`,
        list.title && `Heading: ${list.title}`,
        list.subheading && `Subheading: ${list.subheading}`,
        ...list.items.map((item) => `- ${item}`),
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

/**
 * Join the judge's answers to the lists it was given. A list it skipped counts
 * as unjudged rather than as alike, and an id it made up is dropped, so a
 * sloppy answer can never read as a clean deck.
 *
 * @param {ReturnType<typeof deckItemLists>} lists
 * @param {{lists?: object[]}} verdict
 * @returns {{total: number, judged: number, mixed: number, lists: object[]}}
 */
export function applyListVerdict(lists, verdict) {
  const answers = new Map((verdict?.lists || []).map((a) => [a.id, a]));
  const joined = lists.map((list) => {
    const answer = answers.get(list.id);
    return answer
      ? {
          ...list,
          judged: true,
          alike: answer.alike,
          kinds: answer.kinds,
          strays: answer.strays,
          rationale: answer.rationale,
        }
      : { ...list, judged: false };
  });
  const judged = joined.filter((list) => list.judged);
  return {
    total: joined.length,
    judged: judged.length,
    mixed: judged.filter((list) => !list.alike).length,
    lists: joined,
  };
}

/**
 * Judge whether the lists of one deck hold what they claim. A deck without
 * lists makes no call.
 *
 * @param {Object} options
 * @param {object} options.deck
 * @param {(usage: object) => void} [options.onUsage]
 * @param {boolean} [options.refresh]
 * @returns {Promise<{result: ReturnType<typeof applyListVerdict>, cached: boolean}>}
 */
export async function judgeListKinship({
  deck,
  onUsage = null,
  refresh = false,
}) {
  const lists = deckItemLists(deck);
  if (!lists.length) {
    return { result: applyListVerdict(lists, null), cached: false };
  }

  const prompt = `<lists>\n${renderListsForJudge(lists)}\n</lists>\n\nJudge every list. Return only the JSON object.`;
  const key = cacheKey(LIST_JUDGE_VERSION, MODEL, SYSTEM, prompt);
  const { value, cached } = await withCache(
    'list-judge',
    key,
    async () =>
      requestJson({
        system: SYSTEM,
        prompt,
        schema: SCHEMA,
        maxTokens: 4000,
        onUsage,
      }),
    { skip: refresh },
  );
  return { result: applyListVerdict(lists, value), cached };
}
