/**
 * team-cards-slide — the authoring companions.
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
  group: 'media',

  /**
   * Short "what is this" line, shown as the picker tile's tooltip. English is
   * the fallback; translations live under `editor.slideTypeDesc.<type>`.
   */
  description: 'Image blocks in a grid',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'roster faces headshots portraits people staff team smoelenboek gezichten medewerkers',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'cards', cells: 6, cols: 3, rows: 2 },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   *
   * Placeholder image URLs inlined (see image-slide's note). The first seed is
   * the shared `slide-picker` placeholder the old module also used for
   * image-text-slide; the values are byte-identical, the sharing was incidental.
   */
  sample: {
    title: 'Meet the Team',
    subheading: '',
    members: [
      { image: 'https://picsum.photos/seed/slide-picker/800/600', name: 'Jane Doe', byline: 'CEO & Founder' },
      { image: 'https://picsum.photos/seed/slide-picker-3/800/600', name: 'John Smith', byline: 'Head of Design' },
      { image: 'https://picsum.photos/seed/slide-picker-4/800/600', name: 'Alex Johnson', byline: 'Lead Developer' },
    ],
  },
};
