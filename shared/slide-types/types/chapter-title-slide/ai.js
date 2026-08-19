/**
 * chapter-title-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      A section divider that announces a new topic/chapter.
      Use to break up the presentation into logical sections.
      Should be followed by 1-4 content slides that elaborate on that chapter.
    `,
  bestFor: [
    'Introducing a new major section or topic',
    'Creating visual breaks between different parts of the presentation',
    'Helping audience understand the structure',
  ],
  notFor: [
    'Content that needs explanation (use content slides after this)',
    'Minor sub-topics within a section',
  ],
};
