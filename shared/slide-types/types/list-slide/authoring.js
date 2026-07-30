/**
 * list-slide — the authoring companions.
 *
 * Plain data the editor reads to *offer* this type. Imported by the editor
 * surfaces that need it, never by the definition module: the presenter and the
 * export render slides without ever offering one, and a slide type's picker
 * copy has no business in their payload.
 * See docs/reference/slide-type-directory.md.
 *
 * The presets and sample below came from the retired Dutch alias, which held
 * the richer companions while sharing this type's definition.
 */

export default {
  /**
   * Which curated shelf offers this type: the editor's insert picker and the
   * settings curation list both derive their membership from this key. Display
   * order stays with each consumer. Vocabulary + rationale in
   * shared/slide-types/authoring-groups.js.
   */
  group: 'basic',

  /**
   * Short "what is this" line, shown as the picker tile's tooltip. English is
   * the fallback; translations live under `editor.slideTypeDesc.<type>`.
   */
  description: 'A bulleted or numbered list',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'bullets numbered list styled items opsomming lijstje lijst genummerd',

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
