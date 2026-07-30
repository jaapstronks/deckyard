/**
 * countdown-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
};
