/**
 * Visual Content Slide Types
 *
 * Media and data visualization slides:
 * - image-slide: Full-bleed image
 * - image-text-slide: Split image + text layout
 * - table-slide: Tabular data
 * - chart-slide: Bar/line/pie charts
 */

export const VISUAL_CONTENT_SLIDES = {
  'image-text-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Split layout with an image on one side and text (bullets) on the other.
      Great for visual breaks and when there's a relevant image.
      Keep body concise (3-6 bullets).
    `,
    bestFor: [
      'Content where a photo/image adds value',
      'Product or feature showcases',
      'Person introductions with photo',
      'Location or event context',
    ],
    notFor: [
      'Content without a meaningful image to pair',
      'Heavy text content (use content-slide or split into multiple)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      body: { type: 'markdown', required: false, maxLength: 800 },
      image: { type: 'string', required: false },
      imageSide: { type: 'enum', options: ['left', 'right'] },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'image-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      A single strong visual (full-slide image) with optional caption.
      Use for impactful standalone images.
    `,
    bestFor: [
      'Powerful standalone visuals',
      'Full-bleed photos or screenshots',
      'Visual breaks in the presentation',
    ],
    notFor: ['Content that needs text explanation (use image-text-slide)'],
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      image: { type: 'string', required: false },
      caption: { type: 'string', required: false, maxLength: 200 },
    },
  },

  'table-slide': {
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
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      caption: { type: 'string', required: false, maxLength: 240 },
      headerRow: { type: 'enum', options: ['on', 'off'], default: 'on' },
      colCount: { type: 'enum', options: ['2', '3', '4', '5', '6', '7', '8', '9', '10'], required: true },
      rows: { type: 'array', required: true, description: 'Array of {c1, c2, c3...} objects' },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'chart-slide': {
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
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 200 },
      chartType: { type: 'enum', options: ['bar', 'line', 'pie'], required: true },
      data: { type: 'string', required: true, description: 'TSV format: header\\nrow1\\nrow2' },
      xLabel: { type: 'string', required: false, maxLength: 60 },
      yLabel: { type: 'string', required: false, maxLength: 60 },
    },
  },
};