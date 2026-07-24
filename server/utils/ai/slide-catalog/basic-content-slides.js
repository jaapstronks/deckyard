/**
 * Basic Content Slide Types
 *
 * Simple text and list-based slides:
 * - content-slide: Default text/bullet slide
 * - list-slide: Fancy list with title+description items
 * (content-columns-slide is deprecated — see the note where its entry used to be.)
 */

export const BASIC_CONTENT_SLIDES = {
  'content-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      The default "text" slide for paragraphs and bullet lists.
      USE THIS AS A LAST RESORT - prefer specialized slide types when they fit.

      Good for: general explanatory text, mixed content that doesn't fit other types.
      Layout: default is one-column. Only use two-column for dense content.
    `,
    bestFor: [
      'General explanatory text that does not fit other slide types',
      'Mixed content (some bullets + some paragraphs)',
      'Content that is truly freeform',
    ],
    notFor: [
      'Lists with title+description pairs (use list-slide)',
      'Parallel items/categories with no causal relationship (use list-slide, or icon-card-grid-slide if each needs an icon)',
      'Timelines or sequences (use timeline-slide)',
      'Tables (use table-slide or chart-slide)',
      'Genuine cause→effect / input→output flows between groups (use text-blocks-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      body: { type: 'markdown', required: false, maxLength: 2000 },
      layout: { type: 'enum', options: ['one-column', 'two-column'] },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  'list-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      A "fancy list" slide with structured items. Each item has a title and short explanation.
      Visually cleaner than content-slide bullets. 2-8 items.

      SUBHEADING (optional): a single-sentence intro that sets up the list, like a
      hero/lead paragraph on a web page - NOT a second title. Use it to frame WHY
      these items or WHERE they come from. Example: title "5 trends in duurzaam
      ontwerp", subheading "Op basis van ons jaarlijkse sectoronderzoek zetten we
      de belangrijkste trends op een rij:". Keep it to one line.

      LAYOUT RULES:
      - layout:"one-column" - Use for 2-4 items (default, items stack vertically)
      - layout:"two-column" - Use for 5-8 items (items split into two columns to fit)

      IMPORTANT: When you have 5 or more items, ALWAYS use layout:"two-column"!

      TEXT SIZE (density, optional): "auto" (default sizing), "comfortable" (larger
      titles + text, good for a short list of 2-4 items so it fills the slide),
      "compact" (smaller, good when many items must fit). Prefer "comfortable" for
      sparse lists and "compact" for dense ones.

      Use variant:"numbers" when order matters (steps, ranked items).
      Use variant:"bullets" when order doesn't matter (tips, points).
    `,
    bestFor: [
      'Tips, recommendations, or best practices',
      'Meeting agendas (not roadmaps - those are timeline)',
      'Steps with short explanations',
      'Do/don\'t lists',
      'Key takeaways or highlights',
      'Any list where items have both a title AND a brief explanation',
    ],
    notFor: [
      'NUMERIC HIGHLIGHTS like "220 trajectories" or "10,000 professionals" (use kpi-metrics-slide!)',
      'Output targets or deliverables with specific numbers (use kpi-metrics-slide)',
      'Parallel categories that should be compared side-by-side (use card slides)',
      'Timeline/roadmap with phases over time (use timeline-slide)',
      'Simple bullets without title+text structure (use content-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 160 },
      variant: { type: 'enum', options: ['bullets', 'numbers'] },
      layout: { type: 'enum', options: ['one-column', 'two-column'] },
      density: { type: 'enum', options: ['auto', 'comfortable', 'compact'] },
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 8,
        itemSchema: {
          title: { type: 'string', required: true, maxLength: 80 },
          text: { type: 'string', required: false, maxLength: 120 },
        },
      },
      background: { type: 'enum', options: ['lime', 'mist'] },
    },
  },

  // content-columns-slide: DEPRECATED — removed from AI generation.
  // Existing slides still render via shared/slide-types/types/content-columns-slide.js
  // (and the image-text→content-columns convert seam still works). The type is
  // `deprecated: true` / not insertable, so the AI must not author new ones.
  // Use list-slide or content-slide for plain enumerations, comparison-slide for
  // A vs B, matrix-slide for grids, or icon-card-grid-slide for iconned items.
};