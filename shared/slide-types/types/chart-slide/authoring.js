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
   * Abstract glyph for the picker's schematic view mode. JSON-safe spec read by
   * renderSlideSchematic() — grammar in client/lib/slide-authoring/slide-schematic.js.
   */
  schematic: { kind: 'chart' },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   *
   * The random chart-type pick is preserved verbatim from the old sample map:
   * it runs once when this module is first imported, exactly as it ran once when
   * the old module was imported. A single frozen pick per process, same as
   * before.
   */
  sample: (() => {
    const chartTypes = ['bar', 'line', 'pie'];
    const chartType = chartTypes[Math.floor(Math.random() * chartTypes.length)];
    const chartData = {
      bar: 'Quarter,Revenue\nQ1,45\nQ2,72\nQ3,89\nQ4,120',
      line: 'Month,Sales,Target\nJan,30,25\nFeb,45,40\nMar,55,50\nApr,70,60\nMay,85,75',
      pie: 'Category,Share\nProduct A,35\nProduct B,28\nProduct C,22\nProduct D,15',
    };
    return {
      title: 'Growth Metrics',
      chartType,
      data: chartData[chartType],
      showValues: 'yes',
      showLegend: 'yes',
      background: 'lime',
    };
  })(),
};
