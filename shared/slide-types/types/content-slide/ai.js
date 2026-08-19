/**
 * content-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      The default "text" slide for paragraphs and bullet lists.
      USE THIS AS A LAST RESORT - prefer specialized slide types when they fit.

      Good for: general explanatory text, mixed content that doesn't fit other types.
      Layout: default is one-column. Only use two-column for dense content.
    `,
  bestFor: [
    'General explanatory text that does not fit other slide types',
    'Mixed content (some bullets + some paragraphs)',
    'Content that is truly freeform',
  ],
  notFor: [
    'Lists with title+description pairs (use list-slide)',
    'Parallel items/categories with no causal relationship (use list-slide, or icon-card-grid-slide if each needs an icon)',
    'Timelines or sequences (use timeline-slide)',
    'Tables (use table-slide or chart-slide)',
    'Genuine cause→effect / input→output flows between groups (use text-blocks-slide)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    title: 'Key Findings',
    body: '- First important point with details\n- Second point explaining the context\n- Third point with specific examples\n- Fourth point summarizing implications',
    layout: 'one-column',
    background: 'lime',
  },
];
