/**
 * Diagram Slide Types
 *
 * Structured diagrams and process visualizations:
 * - comparison-slide: Side-by-side A vs B
 * - matrix-slide: 2x2 grid (SWOT, etc.)
 * - pyramid-slide: Hierarchical pyramid
 * - funnel-slide: Conversion/sales funnel
 * - cycle-slide: Circular recurring process
 * - process-slide: Linear step-by-step
 * - timeline-slide: Chronological events, roadmaps, milestones
 */

export const DIAGRAM_SLIDES = {
  'comparison-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Side-by-side comparison of two options/concepts.
      Each side has title and body (Markdown bullets). Optional verdict badge.
      Use for A vs B, pros vs cons, before vs after.
    `,
    bestFor: [
      'A vs B comparisons (products, approaches)',
      'Pros and cons analysis',
      'Before vs after transformations',
      'Option evaluation and decision support',
    ],
    notFor: [
      'More than 2 options (use table-slide or icon-card-grid-slide)',
      '2x2 matrices like SWOT (use matrix-slide)',
    ],
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      leftTitle: { type: 'string', required: true, maxLength: 100 },
      leftBody: { type: 'markdown', required: true, maxLength: 2000 },
      rightTitle: { type: 'string', required: true, maxLength: 100 },
      rightBody: { type: 'markdown', required: true, maxLength: 2000 },
      verdict: { type: 'string', required: false, maxLength: 100 },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'matrix-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      2x2 grid for SWOT, risk matrices, priority grids.
      Exactly 4 cells in quadrants. Each cell has title, body, and tone.
      Tones: default, positive (green), negative (red), neutral.
    `,
    bestFor: [
      'SWOT analysis',
      'Risk vs Impact matrices',
      'Urgent vs Important (Eisenhower)',
      'Any 2x2 framework or quadrant analysis',
    ],
    notFor: [
      'Simple A vs B (use comparison-slide)',
      'More than 4 categories (use text-blocks or table)',
    ],
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      cells: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        itemSchema: {
          title: { type: 'string', required: true, maxLength: 40 },
          body: { type: 'markdown', required: true, maxLength: 1000 },
          tone: { type: 'enum', options: ['default', 'positive', 'negative', 'neutral'] },
        },
      },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'pyramid-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Hierarchical pyramid with 3-6 levels.
      First item = top (pinnacle), last = base (foundation).
      Classic example: Maslow's hierarchy of needs.
    `,
    bestFor: [
      'Maslow-style need pyramids',
      'Priority levels (Critical > High > Medium > Low)',
      'Organizational hierarchies',
      'Skill progression pyramids',
    ],
    notFor: [
      'Narrowing funnels with metrics (use funnel-slide)',
      'Linear processes (use process-slide)',
      'Circular processes (use cycle-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      levels: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        itemSchema: {
          label: { type: 'string', required: true, maxLength: 60 },
          text: { type: 'string', required: false, maxLength: 120 },
        },
      },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'funnel-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Conversion/sales funnel with 3-6 stages.
      First stage = widest (most volume), last = narrowest.
      Each stage has label, optional value/metric, and description.
    `,
    bestFor: [
      'Sales funnels (Leads > Qualified > Closed)',
      'Marketing funnels (Awareness > Interest > Conversion)',
      'Recruitment funnels',
      'Any narrowing process with decreasing numbers',
    ],
    notFor: [
      'Hierarchies without quantity reduction (use pyramid)',
      'Processes that don\'t narrow (use process-slide)',
      'Circular processes (use cycle-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      stages: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        itemSchema: {
          label: { type: 'string', required: true, maxLength: 60 },
          value: { type: 'string', required: false, maxLength: 30 },
          text: { type: 'string', required: false, maxLength: 120 },
        },
      },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'cycle-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Circular process for recurring workflows.
      3-6 stages arranged in circle with arrows.
      Optional centerLabel in the middle.
    `,
    bestFor: [
      'PDCA (Plan-Do-Check-Act) cycles',
      'Agile/Scrum sprint cycles',
      'Continuous improvement processes',
      'Feedback loops',
      'Any process that repeats indefinitely',
    ],
    notFor: [
      'Linear one-time processes (use process-slide)',
      'Timelines with dates (use timeline-slide)',
      'Narrowing funnels (use funnel-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      centerLabel: { type: 'string', required: false, maxLength: 60 },
      stages: {
        type: 'array',
        minItems: 3,
        maxItems: 6,
        itemSchema: {
          label: { type: 'string', required: true, maxLength: 40 },
          text: { type: 'string', required: false, maxLength: 80 },
        },
      },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'process-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Linear step-by-step process with 3-7 numbered steps.
      Direction: horizontal (default) or vertical.
      For one-time workflows, not recurring cycles.
    `,
    bestFor: [
      'Step-by-step procedures',
      'Onboarding processes',
      'Implementation methodologies',
      'How-to guides with sequential steps',
      'Project phases',
    ],
    notFor: [
      'Recurring/cyclical processes (use cycle-slide)',
      'Timelines with specific dates (use timeline-slide)',
      'Narrowing conversions (use funnel-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      direction: { type: 'enum', options: ['horizontal', 'vertical'] },
      steps: {
        type: 'array',
        minItems: 3,
        maxItems: 7,
        itemSchema: {
          title: { type: 'string', required: true, maxLength: 60 },
          text: { type: 'string', required: false, maxLength: 200 },
        },
      },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'timeline-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Chronological timeline with 2-10 DATED events.
      Visual display with cards above and below a timeline track.

      Use for both PAST events (history, milestones) and FUTURE roadmaps
      (phases, development plans, project timelines).

      EVERY item MUST have a real date or date-range — that is what places it on
      the time axis (e.g. "Q1 2025", "Apr 2025", "23 May 2025", "Jul–Oct 2025").
      An item with no date does NOT belong on the timeline. When you turn source
      text into a timeline, keep ONLY the dated events as items; do not invent a
      date, and do not force an undated line into an item.

      Non-dated content goes elsewhere, not as an extra item:
      - A closing/summarising line — a total, an aggregate count, a takeaway
        (e.g. "42 partners across 5 consortia") — belongs in \`bottomSubheading\`.
      - Framing/context for the whole timeline belongs in \`subheading\`.

      Keep item \`title\` short (a few words); put detail in the item's optional
      \`text\`. Keep the slide \`title\` concise (e.g. "ADRIE activities"), not a
      long descriptive sentence.

      IMPORTANT: This is for TIME-BASED sequences, not meeting agendas.
      For meeting agendas, use list-slide instead.
    `,
    bestFor: [
      'Roadmaps with phases (Q1/Q2/Q3, Year 1/2/3, Phase 1/2/3)',
      'Company history and milestones',
      'Project retrospectives and future plans',
      'Historical event sequences',
      'Product evolution timelines',
      'Future development plans',
      'Now/Next/Later timelines',
    ],
    notFor: [
      'Meeting agendas (use list-slide)',
      'Non-sequential items (use icon-card-grid-slide or list-slide)',
      'More than 10 items (split into multiple slides)',
      'Processes without dates/phases (use process-slide)',
      'Undated summary/total lines as items (put them in bottomSubheading)',
    ],
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 200 },
      bottomSubheading: { type: 'string', required: false, maxLength: 200 },
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 10,
        itemSchema: {
          date: { type: 'string', required: true, maxLength: 60 },
          title: { type: 'string', required: true, maxLength: 80 },
          text: { type: 'string', required: false, maxLength: 200 },
        },
      },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },
};