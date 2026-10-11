/**
 * video-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      Embed a video (YouTube, Vimeo, or direct URL).
      Use when video content is explicitly provided or requested.
    `,
  bestFor: ['Embedded video content'],
  notFor: ['Content without a video URL'],
};

/**
 * Worked examples an agent copies field for field.
 *
 * The type's `defaults` are not usable as one: a new video slide is empty by
 * design, and `source` is required, so the empty template is a slide this very
 * type refuses (B653). Its picker sample is no help either — that one leaves
 * `source` blank on purpose so a tile loads no live player (D107). Hence a
 * third description, and the only one meant to be copied.
 *
 * The URL form shown is the self-naming one: a provider URL carries everything
 * needed to play. A bare Bunny UUID is accepted too but needs the
 * installation's library (`configDefaults`, seeded into every new slide), which
 * an agent cannot know, so the example does not teach that shape.
 *
 * Big Buck Bunny is the Blender Foundation's open-licensed (CC-BY) short, the
 * web's standard demo clip: a real, stable, public URL that belongs to nobody's
 * private account.
 */
export const aiExamples = [
  {
    variation: 'A provider URL, which names its own player',
    content: {
      title: 'How a deck travels from draft to room',
      source: 'https://www.youtube.com/watch?v=YE7VzlLtp-4',
      background: 'mist',
      autoplay: 'off',
    },
  },
];
