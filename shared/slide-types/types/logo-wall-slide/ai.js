/**
 * logo-wall-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      Display partner/sponsor/supporter logos in a grid. Logos are shown
      uncropped (contained) with matched heights — never cropped — which is
      exactly what logo artwork needs. Each logo has a name, an optional image,
      and an optional link. Up to 30 logos; fewer logos render larger automatically.

      STRUCTURE:
      - logos: Array of logo objects, each with { image, name, link }
      - image can be empty string if unknown — names alone create placeholder cards
      - link (optional): makes the whole logo clickable — an http(s)/mailto URL,
        or '#N' to jump to slide N in the deck (presenter only)

      Use when partner organisations, sponsors, or supporters are mentioned.
      You don't need actual logo files — names are enough.
    `,
    bestFor: [
      'Partner organizations',
      'Sponsors and funding bodies',
      'Client logos',
      'Supporter acknowledgments',
      'Consortium or coalition members',
    ],
    notFor: [
      'Detailed partner descriptions (use content-slide or icon-card-grid-slide)',
      'People (use team-cards-slide)',
      'Screenshots or photos that want captions (use team-cards-slide or gallery-slide)',
    ],
};
