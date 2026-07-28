/**
 * image-slide — the authoring companions.
 *
 * Plain data the editor reads to *offer* this type. Imported by the editor
 * surfaces that need it, never by the definition module: the presenter and the
 * export render slides without ever offering one, and a slide type's picker
 * copy has no business in their payload.
 * See docs/reference/slide-type-directory.md.
 */

export default {
  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'image' },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   *
   * The placeholder image URL is inlined rather than shared through a module
   * const: an authoring.js is self-contained plain data (no cross-type imports),
   * and the seed is a meaningless picsum id, so a shared const would only force
   * either an import against that principle or the same literal duplicated
   * anyway. gallery-slide and logo-wall-slide already inline theirs.
   */
  sample: {
    title: 'Full Image',
    subheading: 'Beautiful visuals matter',
    image: 'https://picsum.photos/seed/slide-picker-2/800/600',
    alt: 'Sample image',
    imageRole: 'content',
    caption: 'Caption for context',
  },
};
