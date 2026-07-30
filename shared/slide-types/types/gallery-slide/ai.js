/**
 * gallery-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      A curated grid of 2-6 images with optional per-image captions. The go-to
      type for "show these images / screenshots / photos in one slide" when the
      images carry the slide (no long explanatory text). Handles mixed aspect
      ratios well, especially in the masonry layout.

      STRUCTURE:
      - images: Array of 2-6 objects, each with { src, caption, alt }
      - layout: 'grid' (default, even cells), 'masonry' (preserves each image's
        native aspect ratio — best for screenshots and mixed-shape images), or
        'featured' (one large image + smaller ones).

      Use for photo galleries, sets of screenshots, or a handful of related
      images shown together. For images that each need a Title AND a Caption,
      or for more than 6 images / people grids, use team-cards-slide instead.
    `,
    bestFor: [
      'Several screenshots or UI captures in one slide (use layout: masonry)',
      'A photo gallery or set of related images',
      '2-6 images shown together where the images tell the story',
      'Mixed aspect-ratio images that must not be cropped (masonry)',
    ],
    notFor: [
      'A single hero image (use image-slide)',
      'One image beside a paragraph of text (use image-text-slide)',
      'More than 6 images, or images each needing a Title + Caption (use team-cards-slide)',
      'Partner/sponsor logos (use logo-wall-slide)',
    ],
};
