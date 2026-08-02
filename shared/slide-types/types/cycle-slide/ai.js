/**
 * cycle-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: 'PDCA improvement cycle',
    title: 'Continuous Improvement Cycle',
    centerLabel: 'PDCA',
    items: [
      { label: 'Plan', text: 'Identify and analyze' },
      { label: 'Do', text: 'Implement solution' },
      { label: 'Check', text: 'Evaluate results' },
      { label: 'Act', text: 'Standardize or adjust' },
    ],
    background: 'lime',
  },
  {
    _variation: 'Agile sprint cycle',
    title: 'Sprint Workflow',
    centerLabel: '2 Weeks',
    items: [
      { label: 'Planning', text: 'Define sprint goals' },
      { label: 'Development', text: 'Build features' },
      { label: 'Review', text: 'Demo to stakeholders' },
      { label: 'Retrospective', text: 'Improve process' },
    ],
    background: 'mist',
  },
  {
    _variation: 'Customer feedback loop',
    title: 'Customer Feedback Loop',
    centerLabel: 'Listen',
    items: [
      { label: 'Collect', text: 'Gather feedback' },
      { label: 'Analyze', text: 'Identify patterns' },
      { label: 'Prioritize', text: 'Rank improvements' },
      { label: 'Implement', text: 'Make changes' },
      { label: 'Communicate', text: 'Share updates' },
    ],
    background: 'lime',
  },
];
