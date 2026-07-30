/**
 * text-blocks-slide — the authoring companions.
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
  group: 'layouts',

  /**
   * Short "what is this" line, shown as the picker tile's tooltip. English is
   * the fallback; translations live under `editor.slideTypeDesc.<type>`.
   */
  description: 'Several labelled text blocks',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'blocks process blokken stappen',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'blocks', cells: 4 },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    title: 'Our Process',
    subheading: 'From concept to delivery',
    rows: [
      {
        title: '',
        color: 'yellow',
        arrow: 'down',
        blocks: [
          { title: 'Research', body: 'Understanding the challenge' },
          { title: 'Design', body: 'Creating the solution' },
          { title: 'Build', body: 'Making it real' },
        ],
      },
      {
        title: 'The Result',
        color: 'black',
        arrow: 'none',
        blocks: [
          { title: 'Launch', body: 'Going live' },
          { title: 'Measure', body: 'Tracking success' },
          { title: 'Iterate', body: 'Continuous improvement' },
        ],
      },
    ],
  },
};
