/**
 * Interactive Slide Type Definitions
 *
 * Slides for audience interaction:
 * - poll-slide: Multiple choice voting
 * - likert-slide: Labeled scale ratings
 * - likert-slider-slide: Numeric 1-10 slider
 * - feedback-slide: Open-ended text input
 * - countdown-slide: Presenter-run timer for a break or exercise
 */

export const INTERACTIVE_SLIDES = {
  'poll-slide': {
    category: 'interactive',
    resolveInPhase1: false,
    description: `
      Multiple-choice audience poll with 2-4 options.
      Live voting functionality.
    `,
    bestFor: [
      'Audience questions with discrete options',
      '"Which do you prefer?" style questions',
      'Quick pulse checks',
    ],
    notFor: ['Open-ended questions (use feedback-slide)', 'Scale ratings (use likert slides)'],
  },

  'likert-slide': {
    category: 'interactive',
    resolveInPhase1: false,
    description: `
      Survey-style question with labeled scale points (typically 5).
      "Strongly disagree" to "Strongly agree" style.
    `,
    bestFor: [
      'Agreement/disagreement questions',
      'Satisfaction ratings',
      'Any question with a labeled scale',
    ],
    notFor: ['Multiple choice (use poll-slide)', 'Numeric 1-10 rating (use likert-slider-slide)'],
  },

  'likert-slider-slide': {
    category: 'interactive',
    resolveInPhase1: false,
    description: `
      Numeric slider question (1-10 scale).
      Has min and max labels at the ends.
    `,
    bestFor: [
      '"Rate from 1 to 10" questions',
      '"How likely are you to..." questions',
      'Confidence or intensity ratings',
    ],
    notFor: ['Labeled categories (use likert-slide)', 'Multiple choice (use poll-slide)'],
  },

  'feedback-slide': {
    category: 'interactive',
    resolveInPhase1: false,
    description: `
      Open-ended text feedback collection.
      Audience types free-form responses.
    `,
    bestFor: [
      'Open feedback prompts',
      '"What should we improve?" questions',
      'Collecting ideas or suggestions',
    ],
    notFor: ['Structured questions (use poll or likert slides)'],
  },

  'countdown-slide': {
    category: 'interactive',
    resolveInPhase1: false,
    description: `
      A large presenter-controlled countdown timer. Place it where the audience
      works or pauses: a break, a group exercise, a writing round. Only add one
      when the deck actually has such a moment — a timer nobody runs is dead
      weight.
    `,
    bestFor: [
      'Breaks with a stated length ("15 minutes")',
      'Timeboxed exercises in a workshop deck',
    ],
    notFor: [
      'Marking a section boundary (use chapter-title-slide)',
      'A deck that is presented straight through without pauses',
    ],
  },
};