/**
 * chart-slide — the agent-facing editorial layer. **SERVER-ONLY.**
 *
 * This is the hand-written half of the agent contract: when to pick this type
 * and when not to. The other half — the field schema — is derived from the
 * definition's `fields[]` by deriveAgentSchema() and is deliberately absent
 * here (#407).
 *
 * ## Why this file is server-only, and enforced
 *
 * Deckyard has no bundler, so an `import` in a module the browser loads is a
 * file the browser fetches. The AI catalog is ~168 KB of prose that the browser
 * never executes; colocating it *and* importing it from `index.js` would add it
 * to the 368 KB of type modules every presenter page already pulls down. So the
 * rule is: a type's `index.js`/`render.js` import nothing from here, and the
 * server catalog reaches in from its side.
 * tests/slide-type-directory-boundary.test.js fails if that ever stops being
 * true — the track's own point is that an agreement without a test drifts.
 */

export const ai = {
  category: 'content',
  resolveInPhase1: false,
  description: `
      Visualize numeric data as bar, line, or pie chart.

      STRUCTURE:
      - chartType: "bar", "line", or "pie"
      - data: Tab-separated values (TSV) string with header row

      DATA FORMAT (TSV - tabs between columns, newlines between rows):
      "Label\\tValue1\\tValue2\\nItem A\\t100\\t150\\nItem B\\t200\\t180"

      For pie charts, use just two columns (label + value).
      For bar/line charts, can have multiple data series.
    `,
  bestFor: [
    'Trends over time (line chart)',
    'Category comparisons (bar chart)',
    'Parts of a whole (pie chart)',
    'Any numeric data that benefits from visualization',
  ],
  notFor: [
    'Non-numeric comparisons (use table-slide)',
    'Complex multi-dimensional data',
    'Data that needs exact values shown (use table-slide)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from. `data` is TSV: tabs between columns, newlines
 * between rows.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: 'Bar chart with categories',
    title: 'Revenue by Product Line',
    subheading: 'FY 2024 breakdown',
    chartType: 'bar',
    data: 'Product\tRevenue\nElectronics\t450000\nSoftware\t380000\nServices\t290000\nAccessories\t180000',
    xLabel: 'Product Line',
    yLabel: 'Revenue',
  },
  {
    _variation: 'Line chart showing trend over time',
    title: 'Monthly Active Users',
    subheading: 'Growth trajectory 2024',
    chartType: 'line',
    data: 'Month\tUsers (K)\nJan\t120\nFeb\t135\nMar\t148\nApr\t162\nMay\t185\nJun\t210',
    xLabel: 'Month',
    yLabel: 'Users (thousands)',
  },
  {
    _variation: 'Pie chart for distribution',
    title: 'Market Share Distribution',
    subheading: 'Current competitive landscape',
    chartType: 'pie',
    data: 'Segment\tShare\nOur Company\t35\nCompetitor A\t28\nCompetitor B\t22\nOthers\t15',
  },
  {
    _variation: 'Multi-series bar chart',
    title: 'Quarterly Comparison',
    subheading: 'Year-over-year performance',
    chartType: 'bar',
    data: 'Quarter\t2023\t2024\nQ1\t1200\t1450\nQ2\t1350\t1620\nQ3\t1480\t1890\nQ4\t1550\t2100',
    xLabel: 'Quarter',
    yLabel: 'Revenue (K)',
  },
];
