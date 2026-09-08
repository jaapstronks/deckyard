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

      The first row is ALWAYS the header - column names, never a data point,
      even when the names are numbers. "Quarter\\t2023\\t2024" names two series
      called 2023 and 2024; it does not plot anything.

      DATA FORMAT (TSV - tabs between columns, newlines between rows).
      How many columns depends on the chart type:
      - bar and pie read exactly two columns, label + value:
        "Label\\tValue\\nItem A\\t100\\nItem B\\t200"
      - line reads a third column as a second series:
        "Month\\tSeries 1\\tSeries 2\\nJan\\t100\\t150\\nFeb\\t200\\t180"

      Any further column is ignored. There is no grouped/stacked bar: a bar
      chart with two value columns draws the first one only. Use a line chart
      for two series, or one bar chart per series.
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
    // Two series, and therefore a line chart: `parse.js` reads a third column
    // for line only. The same data as a bar chart silently lost the 2024
    // column, so this example used to promise a grouped bar that no renderer
    // draws.
    _variation: 'Two-series line chart',
    title: 'Quarterly Comparison',
    subheading: 'Year-over-year performance',
    chartType: 'line',
    // Bare years, on purpose: the header is the first row by form (D83), so a
    // numeric column name is a column name. This example had to say "FY 2023"
    // while a heuristic still read a numeric second cell as data.
    data: 'Quarter\t2023\t2024\nQ1\t1200\t1450\nQ2\t1350\t1620\nQ3\t1480\t1890\nQ4\t1550\t2100',
    xLabel: 'Quarter',
    yLabel: 'Revenue (K)',
    series1Label: '2023',
    series2Label: '2024',
  },
];
