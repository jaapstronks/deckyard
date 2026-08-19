/**
 * embed-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
  category: 'media',
  resolveInPhase1: false,
  description: `
      Embed a live external page in an iframe (Figma, Miro, a dashboard, a
      Google Sheet). HTTPS only; a non-HTTPS URL renders as an empty frame.
      Only use it when a concrete embed URL is supplied — there is no sensible
      placeholder, and an embed of nothing is worse than a screenshot.
    `,
  bestFor: [
    'Showing a live prototype, board, or dashboard during the talk',
    'Content that must stay current between rehearsal and delivery',
  ],
  notFor: [
    'A video (use video-slide)',
    'A static picture of a tool (use image-slide)',
    'Any case where you would have to invent the URL',
  ],
};
