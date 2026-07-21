/**
 * Card-Based Slide Types
 *
 * Structured card layouts for parallel concepts:
 * - icon-card-grid-slide: 1-6 cards with icons
 * - card-stack-slide: DEPRECATED — use icon-card-grid-slide instead
 * - text-blocks-slide: Multi-row blocks with arrows
 * - kpi-metrics-slide: Prominent numeric KPIs
 */

export const CARD_SLIDES = {
  'icon-card-grid-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      A VISUALLY STRIKING grid of 1-6 cards, each with an icon, title, and body text.
      This is one of the BEST slide types for presenting parallel concepts visually!

      STRUCTURE:
      - items: Array of 1-6 card objects, each with { icon, title, body }

      ICONS: Choose from this list - pick icons that represent the concept:
        People: user, users, users-three, handshake
        Progress: arrow-right, arrow-up, trend-up, chart-line-up, rocket-launch
        Documents: file-text, clipboard-text
        Concepts: lightbulb (ideas), target (goals), gear (settings), globe (global)
        Status: shield-check (security), check-circle (done), warning-circle (alert)
        Other: calendar, heart, star, link

      LAYOUT TIP: 4 cards = 2x2 grid, 5-6 cards = 2x3 grid. Very clean and professional.

      PREFER THIS over content-slide bullets when you have 4-6 distinct categories!
    `,
    bestFor: [
      '4-6 parallel categories or pillars',
      'Focus areas or strategic priorities',
      'Company values or principles',
      'Product features or capabilities',
      'Workstreams, departments, or teams',
      'Service offerings',
      'Benefits or advantages',
      'Any set of 4-6 things that can each have a meaningful icon',
    ],
    notFor: [
      'Time-based sequences (use timeline-slide)',
      'Items that need very long descriptions or bullets (use text-blocks-slide)',
      'Cause-effect relationships (use text-blocks-slide)',
      'Simple lists without icons (use list-slide)',
    ],
    allowedIcons: [
      'user', 'users', 'users-three', 'handshake', 'link',
      'arrow-right', 'arrow-up', 'trend-up', 'chart-line-up',
      'file-text', 'clipboard-text', 'lightbulb', 'target',
      'rocket-launch', 'gear', 'shield-check', 'check-circle',
      'warning-circle', 'calendar', 'globe', 'heart', 'star',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 200 },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        itemSchema: {
          icon: { type: 'string', required: true, maxLength: 40 },
          title: { type: 'string', required: true, maxLength: 80 },
          body: { type: 'markdown', required: false, maxLength: 700 },
        },
      },
    },
  },

  // card-stack-slide: DEPRECATED — removed from AI generation.
  // Existing slides still render via shared/slide-types/types/card-stack-slide.js.
  // Use icon-card-grid-slide for cards with icons, or text-blocks-slide for rich content blocks.

  'text-blocks-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      A SPECIFIC slide for a DIRECTIONAL RELATIONSHIP between 1-3 ROWS of
      colored blocks: the rows are connected by arrows that assert
      cause→effect, input→output, before→after, or problem→solution.

      USE THIS ONLY WHEN THE ROWS GENUINELY RELATE. The arrow between rows
      claims causality or sequence, so picking this type asserts a relationship
      that may not exist. If the content is just parallel points, categories,
      or a plain enumeration with NO cause/sequence between the groups, do NOT
      use text-blocks — use list-slide (title+text items) or content-slide
      (bullets). When in doubt, choose the plainer type.

      SIGNAL TEST: if you would leave every row's arrow on "none", the content
      almost certainly does NOT belong on a text-blocks-slide.

      STRUCTURE: rows[] array with 1-3 row objects. Each row has:
      - title: Optional heading for the row (usually empty for row 1)
      - color: "yellow" (accent, good for inputs/activities) or "black" (dark, good for outputs)
      - arrow: "none", "down", or "up" — the flow to the NEXT row; set "down"/"up"
        when the next row is caused by / produced from this one
      - blocks: Array of 1-6 block objects, each with { title, body }

      GENUINE PATTERNS (each has a real relationship):
      1. TWO-ROW CAUSE→EFFECT: Row 1 (activities, arrow: "down") -> Row 2 (outputs)
      2. THREE-ROW FLOW: Inputs -> Processing -> Outputs
      3. PROBLEM → SOLUTION or BEFORE → AFTER (two contrasting rows)
    `,
    bestFor: [
      'Cause→effect: activities/programmes (A, B, C) that PRODUCE specific outputs',
      'Input→processing→output flows',
      'Problem→solution or challenge→response structures',
      'Before→after transformations',
      'Strategy→tactics→results chains',
      'Any 2-3 row structure where each row LEADS TO the next',
      'Consequence chains: X causes Y, which causes Z. Prefer this over process-slide when nobody performs the steps -- the items are outcomes, not actions',
    ],
    notFor: [
      'Plain enumerations or lists of points (use list-slide or content-slide)',
      'Parallel items/categories with NO causal or sequential relationship — '
        + 'use list-slide, or icon-card-grid-slide if each needs an icon',
      'A single row of blocks used just to group text (use list-slide)',
      'Single items without grouping (use content-slide)',
      'Sequential timelines with dates (use timeline-slide)',
      'Items that each need an icon (use icon-card-grid-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 200 },
      rows: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        itemSchema: {
          title: { type: 'string', required: false, maxLength: 120 },
          color: { type: 'enum', options: ['yellow', 'black'], default: 'yellow' },
          arrow: { type: 'enum', options: ['none', 'down', 'up'], default: 'none' },
          blocks: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            itemSchema: {
              title: { type: 'string', required: true, maxLength: 80 },
              body: { type: 'markdown', required: false, maxLength: 500 },
            },
          },
        },
      },
    },
  },

  'kpi-metrics-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Display 1-4 key metrics/KPIs PROMINENTLY with large, eye-catching numbers.
      This slide type makes numbers the HERO of the slide!

      WHEN TO USE THIS INSTEAD OF LIJSTJE-SLIDE:
      PREFER kpi-metrics-slide when content has:
      - Specific numeric targets or goals (e.g., "220 research trajectories")
      - Output metrics with numbers (e.g., "12 communities", "30 modules", "10,000 professionals")
      - Financial figures or budgets
      - Statistics that should STAND OUT visually

      DO NOT use list-slide for numeric highlights - the numbers will look small and buried!

      Each metric has:
      - value: The number itself (displayed LARGE)
      - unit: Optional suffix (%, M, K, etc.)
      - label: What the number represents
      - note: Optional context — if it starts with +N or -N (e.g. "+12% vs last year"),
              the leading number is auto-coloured green/red
    `,
    bestFor: [
      'NUMERIC OUTPUT TARGETS: "220 research trajectories", "10,000 professionals"',
      'Programme deliverables with specific numbers',
      'Key performance indicators and goals',
      'Budget figures or funding amounts',
      'Statistics and metrics that should STAND OUT',
      'Before/after comparisons with change indicators',
      'Any 1-4 numbers that are the KEY POINT of the slide',
    ],
    notFor: [
      'More than 4 metrics (split into multiple slides or use table/chart)',
      'Qualitative descriptions without clear numeric values',
      'Lists of activities or processes (use list-slide or text-blocks-slide)',
    ],
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      background: { type: 'enum', options: ['lime', 'mist'] },
      metrics: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        itemSchema: {
          value: { type: 'string', required: true, maxLength: 30 },
          unit: { type: 'string', required: false, maxLength: 12 },
          label: { type: 'string', required: true, maxLength: 60 },
          note: { type: 'string', required: false, maxLength: 100 },
        },
      },
    },
  },

};