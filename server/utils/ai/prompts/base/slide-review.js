/**
 * The review keys every slide-writing prompt asks for (B590), one text for
 * refine, append and refine-section. The answer is read by
 * `parseSlideReview()` in `server/utils/ai/slide-review.js`; keep the two in
 * step.
 */

/** The per-slide review keys as they appear in an output example. */
export const SLIDE_REVIEW_EXAMPLE_KEYS = Object.freeze({
  why: 'The source walks through five phases in order, so a timeline shows that sequence',
  alternatives: [
    {
      type: 'list-slide',
      reason: 'Use if the order of the phases matters less than their content',
    },
  ],
  imageSuggestionAfter: {
    reason: 'A photo of the new building would make the next step concrete',
  },
});

/**
 * The rules for the review keys, written for the author in `langLabel`.
 * @param {string} langLabel - the language the author reads
 * @returns {string}
 */
export function buildSlideReviewRules(langLabel) {
  return [
    `REVIEW PER SLIDE (shown to the author in ${langLabel}; no jargon about schemas or fields):`,
    '- "why": ONE short sentence naming what in the source or request made this slide type fit (a sequence, a comparison, figures, ...).',
    '- "alternatives": 0-3 other slide types from the catalog that could also work, each with a one-line "reason". Never the type the slide already has, never the same type twice. Use an empty array when nothing else genuinely fits.',
    '- "imageSuggestionAfter": optional. Add { "reason": "..." } only when a picture right AFTER this slide would genuinely help the audience (a place, a product, a person the slide talks about); omit it otherwise. Most slides have none.',
    '- Never invent an image URL or a stock photo, and never write a "TODO" or "replace image" line. An image field you cannot fill from the source stays empty (""): the author picks the picture.',
  ].join('\n');
}
