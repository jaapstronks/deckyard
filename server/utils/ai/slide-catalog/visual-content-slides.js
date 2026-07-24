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

      LAYOUT VARIANTS:
      - layout "split" (default): one image beside text. imageWidth picks the
        split: "narrow" (1/3 image), "half" (default), "wide" (2/3 image -
        image-dominant, keep body to 2-3 short bullets).
      - layout "corner": one image only in the top corner, the space below
        stays empty air. Very little text room - max 2-3 short bullets.
      - layout "duo": two images stacked beside the text (needs 2 images).
      - layout "row-top" / "row-bottom": a row of 2-3 images above/below the
        text; the number of images sets the columns. About half the slide is
        images, so keep the body short (2-4 bullets).

      IMAGES: prefer the images[] array (max 3 items, each { src, alt }).
      One image: images with a single item. The legacy flat "image" field
      still works for a single image.
    `,
    bestFor: [
      'Content where a photo/image adds value',
      'Product or feature showcases',
      'Person introductions with photo',
      'Location or event context',
      'A small set of 2-3 related images with one shared story (rows/duo)',
    ],
    notFor: [
      'Content without a meaningful image to pair',
      'Heavy text content (use content-slide or split into multiple)',
      'Long bodies on the "wide" or "corner" layouts (little text room)',
      'Many images without text (use gallery-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      body: { type: 'markdown', required: false, maxLength: 800 },
      image: { type: 'string', required: false },
      images: {
        type: 'array',
        required: false,
        maxItems: 3,
        items: { src: { type: 'string' }, alt: { type: 'string', maxLength: 180 } },
      },
      imageSide: { type: 'enum', options: ['left', 'right'] },
      imageWidth: { type: 'enum', options: ['narrow', 'half', 'wide'], default: 'half' },
      layout: {
        type: 'enum',
        options: ['split', 'corner', 'duo', 'row-top', 'row-bottom'],
        default: 'split',
      },
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

  'gallery-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      A curated grid of 2-6 images with optional per-image captions. The go-to
      type for "show these images / screenshots / photos in one slide" when the
      images carry the slide (no long explanatory text). Handles mixed aspect
      ratios well, especially in the masonry layout.

      STRUCTURE:
      - images: Array of 2-6 objects, each with { src, caption, alt }
      - layout: 'grid' (default, even cells), 'masonry' (preserves each image's
        native aspect ratio — best for screenshots and mixed-shape images), or
        'featured' (one large image + smaller ones).

      Use for photo galleries, sets of screenshots, or a handful of related
      images shown together. For images that each need a Title AND a Caption,
      or for more than 6 images / people grids, use team-cards-slide instead.
    `,
    bestFor: [
      'Several screenshots or UI captures in one slide (use layout: masonry)',
      'A photo gallery or set of related images',
      '2-6 images shown together where the images tell the story',
      'Mixed aspect-ratio images that must not be cropped (masonry)',
    ],
    notFor: [
      'A single hero image (use image-slide)',
      'One image beside a paragraph of text (use image-text-slide)',
      'More than 6 images, or images each needing a Title + Caption (use team-cards-slide)',
      'Partner/sponsor logos (use logo-wall-slide)',
    ],
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 200 },
      layout: { type: 'enum', options: ['grid', 'masonry', 'featured'], default: 'grid' },
      images: {
        type: 'array',
        required: true,
        minItems: 2,
        maxItems: 6,
        itemSchema: {
          src: { type: 'string', required: true, description: 'Image URL' },
          caption: { type: 'string', required: false, maxLength: 100 },
          alt: { type: 'string', required: false, maxLength: 200 },
        },
      },
      background: { type: 'enum', options: ['lime', 'mist'] },
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