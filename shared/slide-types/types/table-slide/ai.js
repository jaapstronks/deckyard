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
