/**
 * chart-slide — the authoring companions.
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
  description: 'A bar, line or pie chart',

  /**
   * Extra search terms (incl. Dutch) folded into the picker's search haystack.
   * Never displayed.
   */
  aliases: 'graph bar line pie data viz grafiek diagram',

  /**
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'chart' },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   *
   * One declared example, not a draw. This used to pick a chart type at random
   * on first import ("preserved verbatim from the old sample map"), so the tile
   * showed a different chart per server process and no tracked artifact could
   * pin the type's example (B248). Which chart best shows the type is an
   * authoring decision, so it is decided here: `line`, because `defaults`
   * already demonstrate a single-series bar, and a second series is the thing a
   * reader of the projection has to be able to see (it becomes a third table
   * column).
   */
  sample: {
    title: 'Growth Metrics',
    chartType: 'line',
    data: 'Month,Sales,Target\nJan,30,25\nFeb,45,40\nMar,55,50\nApr,70,60\nMay,85,75',
    showValues: 'yes',
    showLegend: 'yes',
    background: 'lime',
  },
};
