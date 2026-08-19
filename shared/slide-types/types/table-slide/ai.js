/**
 * table-slide — the agent-facing editorial layer. **SERVER-ONLY.**
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
      Display tabular data with rows and columns.

      CRITICAL STRUCTURE - use this EXACT format:
      - colCount: String number "2" to "10" indicating number of columns
      - headerRow: "on" (first row is header) or "off" (no header)
      - rows: Array of objects, each with keys c1, c2, c3... for each column

      EXAMPLE: For a 4-column table with header:
      colCount: "4"
      headerRow: "on"
      rows: [
        { c1: "Header 1", c2: "Header 2", c3: "Header 3", c4: "Header 4" },
        { c1: "Row 1 data", c2: "...", c3: "...", c4: "..." },
        { c1: "Row 2 data", c2: "...", c3: "...", c4: "..." }
      ]

      The first row becomes the header if headerRow is "on".
    `,
  bestFor: [
    'Comparison tables',
    'Feature matrices',
    'Schedules or structured data',
    'Country/region benchmarks',
    'Side-by-side metrics',
  ],
  notFor: [
    'Numeric data that would visualize better (use chart-slide)',
    'Large datasets (summarize or link externally)',
    'More than 10 columns (simplify or split)',
  ],
};

/**
 * Filled-in examples for the generation prompt — the worked content an agent
 * copies the field shape from. Critical: a table uses a `rows` array with
 * c1, c2, c3… keys, NOT a TSV string.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: '4-column comparison table with header',
    title: 'Regional Performance Comparison',
    caption: 'Q4 2024 results across regions',
    colCount: '4',
    headerRow: 'on',
    rows: [
      { c1: 'Region', c2: 'Revenue', c3: 'Growth', c4: 'Status' },
      { c1: 'North', c2: '2.4M', c3: '+15%', c4: 'On target' },
      { c1: 'South', c2: '1.8M', c3: '+8%', c4: 'Growing' },
      { c1: 'East', c2: '1.2M', c3: '+22%', c4: 'Exceeding' },
      { c1: 'West', c2: '2.1M', c3: '+11%', c4: 'On target' },
    ],
    background: 'lime',
  },
  {
    _variation: '3-column feature matrix',
    title: 'Feature Comparison',
    caption: 'What each plan includes',
    colCount: '3',
    headerRow: 'on',
    rows: [
      { c1: 'Feature', c2: 'Basic', c3: 'Pro' },
      { c1: 'Users', c2: '5', c3: 'Unlimited' },
      { c1: 'Storage', c2: '10 GB', c3: '100 GB' },
      { c1: 'Support', c2: 'Email', c3: '24/7 Priority' },
      { c1: 'Analytics', c2: 'Basic', c3: 'Advanced' },
    ],
    background: 'lime',
  },
  {
    _variation: '5-column benchmark table',
    title: 'International Benchmark',
    caption: 'Comparing key metrics across countries',
    colCount: '5',
    headerRow: 'on',
    rows: [
      {
        c1: 'Country',
        c2: 'Companies',
        c3: 'Employees',
        c4: 'Revenue (B)',
        c5: 'Growth',
      },
      { c1: 'Germany', c2: '~600', c3: '12,000', c4: '4.2', c5: '+8%' },
      { c1: 'Netherlands', c2: '~280', c3: '5,500', c4: '1.8', c5: '+12%' },
      { c1: 'Belgium', c2: '~150', c3: '3,200', c4: '0.9', c5: '+6%' },
    ],
    background: 'lime',
  },
];
