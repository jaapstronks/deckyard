/**
 * pyramid-slide — the authoring companions.
 *
 * Plain data the editor reads to *offer* this type. Imported by the editor
 * surfaces that need it, never by the definition module: the presenter and the
 * export render slides without ever offering one, and a slide type's picker
 * copy has no business in their payload.
 * See docs/reference/slide-type-directory.md.
 */

export default {
  /**
   * Which curated shelf offers this type: the editor's insert picker and the
   * settings curation list both derive their membership from this key. Display
   * order stays with each consumer. Vocabulary + rationale in
   * shared/slide-types/authoring-groups.js.
   */
  group: 'data',

  /**
   * Short "what is this" line, shown as the picker tile's tooltip. English is
   * the fallback; translations live under `editor.slideTypeDesc.<type>`.
   */
  description: 'A layered hierarchy pyramid',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'hierarchy layers piramide',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'pyramid' },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    title: 'Priority Pyramid',
    subheading: 'Our focus areas',
    levels: [
      { label: 'Vision', text: 'Long-term goals' },
      { label: 'Strategy', text: 'How we get there' },
      { label: 'Tactics', text: 'Day-to-day actions' },
      { label: 'Operations', text: 'Foundation' },
    ],
    background: 'mist',
  },
};
