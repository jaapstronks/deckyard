/**
 * process-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
    'Chains where each item CAUSES the next rather than being carried out in order (use text-blocks-slide). Test: can you name who performs each step? If yes it is a process; if the items are consequences nobody performs, it is a causal chain',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: 'Horizontal onboarding process',
    title: 'New Employee Onboarding',
    direction: 'horizontal',
    items: [
      { title: 'Pre-boarding', text: 'Paperwork and setup before day one' },
      { title: 'Orientation', text: 'Company intro and team meetings' },
      { title: 'Training', text: 'Role-specific skills and tools' },
      { title: 'Shadowing', text: 'Learn from experienced colleagues' },
      { title: 'Independence', text: 'Start contributing solo' },
    ],
    background: 'lime',
  },
  {
    _variation: 'Vertical project phases',
    title: 'Project Delivery Process',
    direction: 'vertical',
    items: [
      { title: 'Discovery', text: 'Understand requirements and constraints' },
      { title: 'Design', text: 'Create solution architecture' },
      { title: 'Development', text: 'Build and test components' },
      { title: 'Deployment', text: 'Release to production' },
      { title: 'Support', text: 'Monitor and maintain' },
    ],
    background: 'mist',
  },
];
