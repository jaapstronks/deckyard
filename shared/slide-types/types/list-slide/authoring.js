/**
 * list-slide — the authoring companions.
 *
 * Plain data the editor reads to *offer* this type. Imported by the editor
 * surfaces that need it, never by the definition module: the presenter and the
 * export render slides without ever offering one, and a slide type's picker
 * copy has no business in their payload.
 * See docs/reference/slide-type-directory.md.
 *
 * The presets and sample below came from the retired `lijstje-slide` alias,
 * which held the richer companions while sharing this type's definition.
 */

export default {
  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'bullets' },

  /**
   * Per-preset glyph overrides, keyed by the preset id in SLIDE_TYPE_PRESETS
   * (client/views/editor/slide-type-picker/data.js). A preset absent here falls
   * back to `schematic` above.
   */
  presetSchematics: {
    bullets: { kind: 'bullets' },
    numbers: { kind: 'numbers' },
  },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    title: 'Our Process',
    subheading: 'How we approach every project',
    variant: 'numbers',
    layout: 'one-column',
    items: [
      { title: 'Discovery', text: 'Understanding your needs and goals' },
      { title: 'Strategy', text: 'Planning the optimal approach' },
      { title: 'Execution', text: 'Delivering exceptional results' },
      { title: 'Review', text: 'Continuous improvement' },
    ],
    background: 'lime',
  },
};
