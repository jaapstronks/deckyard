/**
 * team-cards-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      A grid of image blocks — each block is an image with an optional Title
      and Caption. Labelled "Image blocks" in the editor. Despite the name,
      this is the general-purpose type for showing MULTIPLE separate images
      in one slide: people (portrait grids), product/UI screenshots,
      testimonials, or any mix of images with short labels. Up to 25 blocks;
      3-6 is the sweet spot for detailed intros, larger sets form a compact grid.

      STRUCTURE:
      - members: Array of blocks, each with { image, name (=Title),
        byline (=Caption), alt, linkedin }. image/name/byline may be empty.
      - imageAspect: 'square' (default, crops each image to a square) or
        'original' (no crop — shows each image at its native aspect ratio).
        RULE OF THUMB: use 'original' for screenshots, UI captures, logos, or
        any mixed-shape images you must NOT crop; use 'square' (with
        imageShape 'circle') for people/portrait grids.
      - imageShape: 'rounded' (default), 'square', or 'circle'. 'circle' forces
        a square crop — best for rosters/boards/team headshots.
      - textPosition: 'below' (default, Title+Caption under the image) or
        'split' (Title above image, Caption below).
      - showPhotoFrame: 'on' | 'off' (default) — adds a card frame behind each image.
      - columnSplit: '' | '1'..'5' — splits blocks into a left/right group with
        its own subheading (subheading2), e.g. two contrasting sets side by side.

      Use this whenever several distinct images belong together in one slide,
      or whenever people are mentioned by name with their roles.
    `,
  bestFor: [
    'Multiple screenshots / UI captures in one slide (imageAspect: original)',
    'Testimonials or mixed image grids with short labels',
    'Team introductions and speaker panels (name + role)',
    'Advisory boards or committees (up to 25, imageShape: circle)',
    'Any set of separate images that each want a small Title/Caption',
  ],
  notFor: [
    'A single hero image (use image-slide)',
    'One image beside a paragraph of text (use image-text-slide)',
    'A curated photo gallery with masonry/featured layout (use gallery-slide)',
    'More than 25 blocks (split into multiple slides)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    title: 'Leadership Team',
    subheading: 'Meet our experts',
    members: [
      { image: '', name: 'Jane Smith', byline: 'CEO' },
      { image: '', name: 'John Doe', byline: 'CTO' },
      { image: '', name: 'Alice Johnson', byline: 'COO' },
    ],
  },
];
