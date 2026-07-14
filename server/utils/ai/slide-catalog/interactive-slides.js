/**
 * Interactive Slide Type Definitions
 *
 * Slides for audience interaction:
 * - poll-slide: Multiple choice voting
 * - likert-slide: Labeled scale ratings
 * - likert-slider-slide: Numeric 1-10 slider
 * - feedback-slide: Open-ended text input
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
    schema: {
      question: { type: 'string', required: true, maxLength: 200 },
      option1: { type: 'string', required: true, maxLength: 100 },
      option2: { type: 'string', required: true, maxLength: 100 },
      option3: { type: 'string', required: false, maxLength: 100 },
      option4: { type: 'string', required: false, maxLength: 100 },
    },
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
    schema: {
      question: { type: 'string', required: true, maxLength: 200 },
      option1: { type: 'string', required: true, maxLength: 60 },
      option2: { type: 'string', required: true, maxLength: 60 },
    },
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
    schema: {
      question: { type: 'string', required: true, maxLength: 200 },
      minLabel: { type: 'string', required: true, maxLength: 60 },
      maxLabel: { type: 'string', required: true, maxLength: 60 },
    },
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
    schema: {
      question: { type: 'string', required: true, maxLength: 200 },
      placeholder: { type: 'string', required: false, maxLength: 100 },
    },
  },
};