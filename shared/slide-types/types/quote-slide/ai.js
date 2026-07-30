/**
 * quote-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
    category: 'structural',
    resolveInPhase1: true,
    description: `
      A visually prominent slide for a single powerful quote.
      Great for interviews, testimonials, and memorable statements.
      Keep quotes short (1-3 sentences, max ~260 characters).
    `,
    bestFor: [
      'Direct quotes from interviews',
      'Memorable one-liners or punchy statements',
      'Testimonials or endorsements',
      'Key takeaways phrased as quotes',
    ],
    notFor: [
      'Long passages (summarize or use content-slide)',
      'Multiple quotes (use one quote-slide per quote, spaced apart)',
      'Back-to-back placement (space them out in the deck)',
    ],
    varietyRule: 'Never place two quote-slides adjacent to each other',
};
