/**
 * icon-card-grid-slide — the authoring companions.
 *
 * Everything an author-facing surface needs to *offer* this type: how the
 * picker describes it, what people search for when they mean it, the schematic
 * glyph, the sample content its thumbnail renders, and which group it belongs
 * to in the picker and in the org curation list.
 *
 * Imported by the editor surfaces that need it, never by `index.js`: the
 * presenter and the export render slides without ever offering one, and a slide
 * type's copy has no business in their payload. See
 * docs/reference/slide-type-directory.md.
 *
 * Plain data only (no DOM, no i18n calls, no imports from `client/`), so the
 * file stays readable from either side and from tooling.
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
  description: 'Cards with an icon and label',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'cards features icons kaarten iconen',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'iconCards', cells: 6, cols: 3, rows: 2 },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    title: 'Our Approach',
    subheading: 'What makes us different',
    items: [
      { icon: 'lightbulb', title: 'Insight', body: 'Deep understanding' },
      { icon: 'target', title: 'Focus', body: 'Clear objectives' },
      { icon: 'users', title: 'Collaboration', body: 'Working together' },
      { icon: 'trend-up', title: 'Growth', body: 'Continuous progress' },
    ],
  },
};
