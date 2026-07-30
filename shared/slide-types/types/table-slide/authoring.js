/**
 * table-slide — the authoring companions.
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
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'table' },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    title: 'Quarterly Results',
    caption: 'All figures in thousands',
    headerRow: 'on',
    colCount: '4',
    rows: [
      { c1: 'Metric', c2: 'Q1', c3: 'Q2', c4: 'Q3' },
      { c1: 'Revenue', c2: '$120K', c3: '$185K', c4: '$240K' },
      { c1: 'Users', c2: '2,400', c3: '3,800', c4: '5,200' },
      { c1: 'Growth', c2: '+18%', c3: '+42%', c4: '+67%' },
    ],
    background: 'lime',
  },
};
