/**
 * LLM-as-judge for the outline, before any slide types or copy exist.
 *
 * This is the diagnostic that tells you *which prompt to fix*. If the outline
 * already splits the document badly, no amount of phase 2 tuning will save the
 * deck, and iterating on slide copy is wasted spend. Only when the outline
 * scores well is a bad deck actually phase 2's fault.
 *
 * Scored dimensions deliberately do not overlap the deck rubric: this judge
 * never sees a slide type or final copy, so it cannot grade slide economy or
 * presentability.
 */

import { requestJson } from '../lib/anthropic.js';
import { cacheKey, withCache } from '../lib/cache.js';
import { MODEL } from '../lib/config.js';

const OUTLINE_JUDGE_VERSION = 'outline-judge-v1';

export const OUTLINE_DIMENSIONS = ['sectioning', 'ordering', 'allocation', 'selection'];

export const OUTLINE_DIMENSION_LABELS = {
  sectioning: 'Sectioning',
  ordering: 'Ordering',
  allocation: 'Slide allocation',
  selection: 'Content selection',
};

const SYSTEM = `You evaluate the OUTLINE of a presentation, before any slide types or final copy exist.

You are given a source document and a proposed outline: a title, a summary, and
an ordered list of planned slides. Each planned slide has an intent (chapter
divider, content, quote, closing) and rough content describing what will go on
it.

Judge the plan, not the prose. You are not scoring wording quality — a plan can
be excellent with clumsy placeholder text.

Score each dimension 1-5. Be discriminating: if every outline scores 4, the
scores are useless.

- sectioning: is the document broken into the right number of sections, at the
  right boundaries? Penalise sections that cut across a single argument, a
  section count that ignores how the source actually decomposes, and chapter
  dividers inserted where the material does not change subject.
- ordering: does the sequence build correctly? Penalise an order that forces the
  audience to hold an unexplained term, that buries the headline finding late,
  or that is merely the source's own order when the source is not organised for
  an audience.
- allocation: does each planned slide earn its place, and does the number of
  slides per section match how much that section actually has to say? Penalise
  a thin point given three slides, a dense point crammed into one, and slides
  that would restate a neighbour.
- selection: does the plan keep the source's most important material and drop
  the rest? Penalise an outline that plans slides for procedural or boilerplate
  content while omitting a headline figure or finding.

Rules for rationales:
- Cite specific evidence: a planned slide's index, its rough content, or a named
  section of the source. "Good structure" is useless; "slides 4-6 all cover
  onboarding, which the source treats in one paragraph" is useful.
- Say what the outline should have done instead.
- 1-3 sentences per dimension.

Also return:
- worstSection: the index range of the weakest stretch of the outline (e.g.
  "slides 7-10"), or "none" if the plan is sound throughout. This is used to
  decide which section to re-run when iterating, so be precise.
- topLevelIssue: the single most valuable fix, phrased as an instruction to
  whoever maintains the outline prompt.`;

const SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'object',
      properties: Object.fromEntries(
        OUTLINE_DIMENSIONS.map((dimension) => [
          dimension,
          {
            type: 'object',
            properties: {
              score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
              rationale: { type: 'string' },
            },
            required: ['score', 'rationale'],
            additionalProperties: false,
          },
        ])
      ),
      required: OUTLINE_DIMENSIONS,
      additionalProperties: false,
    },
    worstSection: { type: 'string' },
    topLevelIssue: { type: 'string' },
  },
  required: ['scores', 'worstSection', 'topLevelIssue'],
  additionalProperties: false,
};

/**
 * Render an outline as compact text for the judge.
 *
 * @param {object} outline
 * @returns {string}
 */
export function renderOutlineForJudge(outline) {
  const lines = [`Title: ${outline.title}`];
  if (outline.subtitle) lines.push(`Subtitle: ${outline.subtitle}`);
  if (outline.summary) lines.push(`Summary: ${outline.summary}`);
  lines.push('');

  for (const [index, slide] of (outline.slides || []).entries()) {
    lines.push(`Planned slide ${index + 1} [intent: ${slide.intent}, group: ${slide.groupId || '-'}]`);
    if (slide.hints?.length) lines.push(`  hints: ${slide.hints.join(', ')}`);
    lines.push(`  ${String(slide.roughContent || '').replace(/\n/g, '\n  ')}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Judge one outline.
 *
 * @param {Object} options
 * @param {import('../lib/cases.js').CaseManifest} options.testCase
 * @param {string} options.sourceText
 * @param {object} options.outline
 * @param {(usage: object) => void} [options.onUsage]
 * @param {boolean} [options.refresh]
 * @returns {Promise<{verdict: object, cached: boolean}>}
 */
export async function judgeOutline({ testCase, sourceText, outline, onUsage = null, refresh = false }) {
  const context = `<source_document case="${testCase.id}">\n${sourceText}\n</source_document>`;
  const prompt = [
    `<proposed_outline>\n${renderOutlineForJudge(outline)}\n</proposed_outline>`,
    'Score the outline against the source document. Return only the JSON object.',
  ].join('\n\n');

  const key = cacheKey(OUTLINE_JUDGE_VERSION, MODEL, SYSTEM, context, prompt);

  const { value, cached } = await withCache(
    'judge-outline',
    key,
    async () =>
      requestJson({ system: SYSTEM, largeContext: context, prompt, schema: SCHEMA, maxTokens: 6000, onUsage }),
    { skip: refresh }
  );

  return { verdict: value, cached };
}

/**
 * Deterministic shape metrics for an outline. Free — no model call.
 *
 * @param {object} outline
 * @returns {object}
 */
export function outlineMetrics(outline) {
  const slides = outline.slides || [];
  const byIntent = {};
  for (const slide of slides) byIntent[slide.intent] = (byIntent[slide.intent] || 0) + 1;

  const groups = new Map();
  for (const slide of slides) {
    if (slide.intent !== 'content') continue;
    const id = slide.groupId || 'ungrouped';
    groups.set(id, (groups.get(id) || 0) + 1);
  }
  const sizes = [...groups.values()];

  return {
    plannedSlides: slides.length,
    byIntent,
    sectionCount: groups.size,
    slidesPerSection: {
      min: sizes.length ? Math.min(...sizes) : 0,
      max: sizes.length ? Math.max(...sizes) : 0,
      mean: sizes.length
        ? Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * 100) / 100
        : 0,
    },
    // Sections holding a single slide usually mean the split was too eager.
    singleSlideSections: sizes.filter((n) => n === 1).length,
    dividerShare: slides.length
      ? Math.round(((byIntent.chapter || 0) / slides.length) * 100) / 100
      : 0,
  };
}
