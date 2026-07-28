/**
 * content-slide — the authoring companions.
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
  schematic: { kind: 'oneCol' },

  // No `presetSchematics`, because content-slide has no picker presets on
  // purpose (see SLIDE_TYPE_PRESETS in slide-type-picker/data.js): its
  // two-column layout is a CSS text-flow variant that only splits once the body
  // is long enough, so it reads as "one column" in an empty new slide. That
  // layout stays reachable via the editor's layout switcher.
};
