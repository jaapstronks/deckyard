/**
 * pyramid-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: 'Maslow hierarchy style',
    title: 'Customer Needs Hierarchy',
    levels: [
      { label: 'Delight', text: 'Unexpected positive experiences' },
      { label: 'Satisfaction', text: 'Meeting all expectations' },
      { label: 'Functionality', text: 'Product works as intended' },
      { label: 'Reliability', text: 'Consistent performance' },
      { label: 'Basic Needs', text: 'Core requirements met' },
    ],
    background: 'lime',
  },
  {
    _variation: 'Priority levels',
    title: 'Issue Priority Levels',
    levels: [
      { label: 'Critical', text: 'System down, immediate action' },
      { label: 'High', text: 'Major impact, urgent response' },
      { label: 'Medium', text: 'Moderate impact, planned fix' },
      { label: 'Low', text: 'Minor issue, backlog' },
    ],
    background: 'mist',
  },
];
