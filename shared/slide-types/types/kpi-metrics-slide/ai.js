/**
 * kpi-metrics-slide — the agent-facing editorial layer. **SERVER-ONLY.**
 *
 * This is the hand-written half of the agent contract: when to pick this type
 * and when not to. The other half — the field schema — is derived from the
 * definition's `fields[]` by deriveAgentSchema() and is deliberately absent
 * here (#407).
 *
 * ## Why this file is server-only, and enforced
 *
 * Deckyard has no bundler, so an `import` in a module the browser loads is a
 * file the browser fetches. The AI catalog is ~168 KB of prose that the browser
 * never executes; colocating it *and* importing it from `index.js` would add it
 * to the 368 KB of type modules every presenter page already pulls down. So the
 * rule is: a type's `index.js`/`render.js` import nothing from here, and the
 * server catalog reaches in from its side.
 * tests/slide-type-directory-boundary.test.js fails if that ever stops being
 * true — the track's own point is that an agreement without a test drifts.
 */

export const ai = {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Display 1-4 key metrics/KPIs PROMINENTLY with large, eye-catching numbers.
      This slide type makes numbers the HERO of the slide!

      WHEN TO USE THIS INSTEAD OF LIJSTJE-SLIDE:
      PREFER kpi-metrics-slide when content has:
      - Specific numeric targets or goals (e.g., "220 research trajectories")
      - Output metrics with numbers (e.g., "12 communities", "30 modules", "10,000 professionals")
      - Financial figures or budgets
      - Statistics that should STAND OUT visually

      DO NOT use list-slide for numeric highlights - the numbers will look small and buried!

      Each metric has:
      - value: The number itself (displayed LARGE)
      - unit: Optional suffix (%, M, K, etc.)
      - label: What the number represents
      - note: Optional context — if it starts with +N or -N (e.g. "+12% vs last year"),
              the leading number is auto-coloured green/red
    `,
    bestFor: [
      'NUMERIC OUTPUT TARGETS: "220 research trajectories", "10,000 professionals"',
      'Programme deliverables with specific numbers',
      'Key performance indicators and goals',
      'Budget figures or funding amounts',
      'Statistics and metrics that should STAND OUT',
      'Before/after comparisons with change indicators',
      'Any 1-4 numbers that are the KEY POINT of the slide',
    ],
    notFor: [
      'More than 4 metrics (split into multiple slides or use table/chart)',
      'Qualitative descriptions without clear numeric values',
      'Lists of activities or processes (use list-slide or text-blocks-slide)',
    ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    title: 'Key Results',
    background: 'lime',
    metrics: [
      { value: '85', unit: '%', label: 'Customer Satisfaction', delta: '+12%' },
      { value: '2.5', unit: 'M', label: 'Users Reached', delta: '+500K' },
      { value: '40', unit: '%', label: 'Cost Reduction' },
    ],
  },
];
