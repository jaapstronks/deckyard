/**
 * kpi-metrics-slide — the authoring companions.
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
  schematic: { kind: 'kpi', cells: 4 },

  /**
   * Rich example content for the picker's preview thumbnails — what a good
   * slide of this type looks like, not what an empty one looks like (that is
   * `defaults` on the definition).
   */
  sample: {
    title: 'Key Metrics',
    metric1Value: '98%',
    metric1Label: 'Customer Satisfaction',
    metric2Value: '500+',
    metric2Label: 'Projects Completed',
    metric3Value: '24/7',
    metric3Label: 'Support Available',
    background: 'lime',
  },
};
