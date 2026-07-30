/**
 * comparison-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
};
