/**
 * image-text-slide — the authoring companions.
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
  schematic: { split: 50 },

  /**
   * Per-preset glyph overrides, keyed by the preset id in SLIDE_TYPE_PRESETS
   * (client/views/editor/slide-type-picker/data.js). A preset absent here falls
   * back to `schematic` above.
   */
  presetSchematics: {
    'image-left': { split: 50 },
    'image-right': { split: 50, mirror: true },
    'image-wide': { split: 63 },
    'image-corner': { corner: 45, mirror: true },
    'image-row': { row: 'top' },
  },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   *
   * The placeholder image URL is inlined (see image-slide's note). This is the
   * shared `slide-picker` seed the old module also used for team-cards-slide;
   * the value is byte-identical, the sharing was incidental.
   */
  sample: {
    image: 'https://picsum.photos/seed/slide-picker/800/600',
    caption: '',
    alt: 'Sample image',
    imageRole: 'content',
    imageSide: 'left',
    title: 'Visual Storytelling',
    body: '- Engage your audience\n- Communicate complex ideas\n- Leave a lasting impression',
    background: 'lime',
  },
};
