/**
 * image-text-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      Split layout with an image on one side and text (bullets) on the other.
      Great for visual breaks and when there's a relevant image.
      Keep body concise (3-6 bullets).

      LAYOUT VARIANTS:
      - layout "split" (default): one image beside text. imageWidth picks the
        split: "narrow" (1/3 image), "half" (default), "wide" (2/3 image -
        image-dominant, keep body to 2-3 short bullets).
      - layout "corner": one image only in the top corner, the space below
        stays empty air. Very little text room - max 2-3 short bullets.
      - layout "duo": two images stacked beside the text (needs 2 images).
      - layout "row-top" / "row-bottom": a row of 2-3 images above/below the
        text; the number of images sets the columns. About half the slide is
        images, so keep the body short (2-4 bullets).

      IMAGES: prefer the images[] array (max 3 items, each { src, alt }).
      One image: images with a single item. The legacy flat "image" field
      still works for a single image.

      ASIDE (optional): a small contrast block inside the slide, for a caveat
      or pointer that would clutter the body but does not deserve its own
      slide. Set asideVariant to "note", "tip" or "warning" and put one or two
      sentences in asideText; leave asideVariant "none" (the default) and there
      is no aside. Something the audience must actually stop at belongs on a
      callout-slide instead — an inset is a footnote, not a beat.
    `,
  bestFor: [
    'Content where a photo/image adds value',
    'Product or feature showcases',
    'Person introductions with photo',
    'Location or event context',
    'A small set of 2-3 related images with one shared story (rows/duo)',
  ],
  notFor: [
    'Content without a meaningful image to pair',
    'Heavy text content (use content-slide or split into multiple)',
    'Long bodies on the "wide" or "corner" layouts (little text room)',
    'Many images without text (use gallery-slide)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    title: 'Our Approach',
    body: '- User-centered design process\n- Iterative development cycles\n- Continuous feedback integration',
    image: '',
    imageSide: 'right',
    background: 'lime',
  },
];
