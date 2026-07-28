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
};
