/**
 * matrix-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: 'SWOT analysis',
    title: 'SWOT Analysis',
    cells: [
      { title: 'Strengths', body: '- Strong brand recognition\n- Experienced team\n- Proprietary technology', tone: 'positive' },
      { title: 'Weaknesses', body: '- Limited market presence\n- High operating costs\n- Legacy systems', tone: 'negative' },
      { title: 'Opportunities', body: '- Emerging markets\n- New partnerships\n- Digital expansion', tone: 'positive' },
      { title: 'Threats', body: '- Increasing competition\n- Regulatory changes\n- Economic uncertainty', tone: 'negative' },
    ],
    background: 'lime',
  },
  {
    _variation: 'Eisenhower priority matrix',
    title: 'Priority Matrix',
    cells: [
      { title: 'Urgent + Important', body: '- Crisis management\n- Deadline-driven projects\n- Critical issues', tone: 'negative' },
      { title: 'Not Urgent + Important', body: '- Strategic planning\n- Relationship building\n- Personal development', tone: 'positive' },
      { title: 'Urgent + Not Important', body: '- Most interruptions\n- Some meetings\n- Some emails', tone: 'neutral' },
      { title: 'Not Urgent + Not Important', body: '- Time wasters\n- Busy work\n- Escapism activities', tone: 'default' },
    ],
    background: 'mist',
  },
];
