/**
 * image-set-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      A small set of 2-3 images that share one story, with a title and a short
      body beside or under them.

      IMAGES: the "images" array, 2-3 items, each { src, alt }. There is no
      single-image field on this type - one image beside text is an
      image-text-slide.

      LAYOUT VARIANTS:
      - layout "top" (default) / "bottom": a row of images above/below the
        text; the number of images sets the columns. About half the slide is
        images, so keep the body short (2-4 bullets).
      - layout "beside": the images stack beside the text. imageSide picks the
        side, imageWidth the split ("narrow" 1/3, "half" default, "wide" 2/3).
      - textColumns "2" sets the body in two columns, in every layout.

      ASIDE (optional): a small contrast block inside the slide, for a caveat
      or pointer that would clutter the body but does not deserve its own
      slide. Set asideVariant to "note", "tip" or "warning" and put one or two
      sentences in asideText; leave asideVariant "none" (the default) and there
      is no aside.
    `,
  bestFor: [
    'A small set of 2-3 related images with one shared story',
    'Before/after or step-by-step visuals that belong on one slide',
    'A product or location shown from a few angles',
  ],
  notFor: [
    'One image beside text (use image-text-slide)',
    'Many images without text (use gallery-slide)',
    'Heavy text content (use content-slide or split into multiple)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    title: 'Before and after',
    body: '- The old flow took four screens\n- The new one takes two',
    images: [
      { src: '', alt: 'The old flow' },
      { src: '', alt: 'The new flow' },
    ],
    layout: 'top',
    background: 'lime',
  },
];
