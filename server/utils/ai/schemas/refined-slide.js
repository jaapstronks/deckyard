/**
 * Zod Schemas for Refined Slide Content
 *
 * These schemas validate the content structure of Phase 2 AI output.
 * They complement existing validation in validate-slides/index.js but provide
 * stricter type checking with detailed error messages.
 *
 * Usage:
 * - validateSlideContent(type, content) - validate and get issues
 * - Schemas are used for logging/debugging, not blocking (AI output is fixed, not rejected)
 */

import { z } from 'zod';

// =============================================================================
// COMMON FIELD SCHEMAS
// =============================================================================

const titleSchema = z.string().max(120).optional();
const requiredTitleSchema = z.string().min(1).max(120);
const subheadingSchema = z.string().max(200).optional();
const bodySchema = z.string().max(2000).optional();
const backgroundSchema = z.enum(['lime', 'mist']).optional();
const layoutSchema = z.enum(['one-column', 'two-column']).optional();

// =============================================================================
// ITEM SCHEMAS
// =============================================================================

const listItemSchema = z.object({
  title: z.string().min(1).max(80),
  text: z.string().max(120).optional(),
});

// Timeline item - accepts both 'date' (preferred) and 'time' (back-compat with old agenda-timeline)
const timelineItemSchema = z.object({
  date: z.string().max(60).optional(),
  time: z.string().max(60).optional(), // Back-compat alias for date
  title: z.string().min(1).max(80),
  text: z.string().max(200).optional(),
});

const metricSchema = z.object({
  value: z.string().min(1).max(30),
  unit: z.string().max(12).optional(),
  label: z.string().min(1).max(60),
  delta: z.string().max(24).optional(),
  note: z.string().max(80).optional(),
});

// Diagram-geometry item shapes. The canonical array is `items`; the legacy
// `steps`/`stages` aliases carry the same shape (see the type definitions).
const processItemSchema = z.object({
  title: z.string().min(1).max(60),
  text: z.string().max(200).optional(),
});

const funnelItemSchema = z.object({
  label: z.string().min(1).max(60),
  value: z.string().max(30).optional(),
  text: z.string().max(120).optional(),
});

const pyramidLevelSchema = z.object({
  label: z.string().min(1).max(60),
  text: z.string().max(120).optional(),
});

const cycleItemSchema = z.object({
  label: z.string().min(1).max(40),
  text: z.string().max(80).optional(),
});

const galleryImageSchema = z
  .object({
    src: z.string().min(1),
    focusX: z.number().optional(),
    focusY: z.number().optional(),
    caption: z.string().max(100).optional(),
    alt: z.string().max(200).optional(),
  })
  .passthrough();

// =============================================================================
// SLIDE CONTENT SCHEMAS
// =============================================================================

// Title Slide (Phase 1 resolved)
const titleSlideSchema = z.object({
  title: requiredTitleSchema,
  subheading: subheadingSchema,
  // One generic meta line (speaker · date · organisation).
  meta: subheadingSchema,
  background: backgroundSchema,
});

// Chapter Title Slide (Phase 1 resolved) - only renders title, not subtitle
const chapterTitleSlideSchema = z
  .object({
    title: requiredTitleSchema,
  })
  .passthrough();

// Quote Slide (Phase 1 resolved)
// `authorName` is required here rather than optional because the structural
// validator used to check it and no longer does: quote-slide is a singleton, so
// it owes no entry under the structure-validation rule. The check has to live
// somewhere, and the field contract already says required.
const quoteSlideSchema = z.object({
  quote: z.string().min(1).max(280),
  authorName: z.string().min(1).max(80),
  authorTitle: z.string().max(120).optional(),
});

// Payoff Slide (closing) - displays only theme logo, no content fields
const payoffSlideSchema = z.object({}).passthrough();

// Content Slide (fallback slide type)
const contentSlideSchema = z.object({
  title: requiredTitleSchema,
  body: bodySchema,
  layout: layoutSchema,
  background: backgroundSchema,
});

// List Slide (fancy list)
const listSlideSchema = z.object({
  title: requiredTitleSchema,
  subheading: z.string().max(160).optional(),
  variant: z.enum(['bullets', 'numbers']).optional(),
  layout: layoutSchema,
  items: z.array(listItemSchema).min(2).max(8),
  background: backgroundSchema,
});

// Timeline Slide (consolidated from agenda-timeline-slide)
const timelineSlideSchema = z.object({
  title: titleSchema,
  subheading: subheadingSchema,
  // Undated summary/total line (e.g. "42 partners across 5 consortia"); the
  // catalog steers non-dated takeaways here instead of into a dateless item.
  bottomSubheading: subheadingSchema,
  items: z.array(timelineItemSchema).min(2).max(10),
  background: backgroundSchema,
});

// KPI Metrics Slide
const kpiMetricsSlideSchema = z.object({
  title: titleSchema,
  metrics: z.array(metricSchema).min(1).max(4),
  background: backgroundSchema,
});

// Icon Card Grid Slide
const iconCardGridSlideSchema = z
  .object({
    title: requiredTitleSchema,
    subheading: subheadingSchema,
    items: z
      .array(
        z.object({
          icon: z.string().max(40).optional(),
          title: z.string().max(80),
          body: z.string().max(700).optional(),
        }),
      )
      .min(1)
      .max(6),
  })
  .passthrough();

// Text Blocks Slide
// rows[] is the canonical shape (post-A0.4): an agent authors the array, which
// carries up to 4 rows. The legacy numbered mirror below (row1Count, ...) is
// FROZEN at 3 rows and optional — a 4-row slide exists only in rows[] form.
// Mirrors how teamCards/logoWall accept their arrays: the array is
// validated here, the numbered fields stay optional and pass through. Before
// this, row1Count was required and rows[] unknown, so every array-canonical
// slide (including each new one, whose defaults are rows[]-only) failed refine
// validation. See A0.4 in docs/plans.
const textBlockSchema = z
  .object({
    title: z.string().max(80).optional(),
    body: z.string().max(500).optional(),
  })
  .passthrough();

const textBlocksRowSchema = z
  .object({
    title: z.string().max(120).optional(),
    color: z.enum(['yellow', 'black']).optional(),
    arrow: z.enum(['none', 'down', 'up']).optional(),
    blocks: z.array(textBlockSchema).max(6).optional(),
  })
  .passthrough();

const textBlocksSlideSchema = z
  .object({
    title: requiredTitleSchema,
    subheading: subheadingSchema,
    bottomSubheading: subheadingSchema,
    rows: z.array(textBlocksRowSchema).min(1).max(4).optional(),
    row1Count: z.enum(['1', '2', '3', '4', '5', '6']).optional(),
    row1Color: z.enum(['yellow', 'black']).optional(),
    arrow1: z.enum(['none', 'down', 'up']).optional(),
    row2Enabled: z.enum(['yes', 'no']).optional(),
    row2Title: titleSchema,
    row2Count: z.enum(['1', '2', '3', '4', '5', '6']).optional(),
    row2Color: z.enum(['yellow', 'black']).optional(),
    arrow2: z.enum(['none', 'down', 'up']).optional(),
    row3Enabled: z.enum(['yes', 'no']).optional(),
    row3Title: titleSchema,
    row3Count: z.enum(['1', '2', '3', '4', '5', '6']).optional(),
    row3Color: z.enum(['yellow', 'black']).optional(),
  })
  .passthrough();

// Table Slide
const tableSlideSchema = z
  .object({
    title: titleSchema,
    colCount: z.string().optional(),
    headerRow: z.enum(['on', 'off']).optional(),
    rows: z.array(z.record(z.string())).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Chart Slide
const chartSlideSchema = z
  .object({
    title: titleSchema,
    chartType: z
      .enum(['bar', 'line', 'pie', 'doughnut', 'horizontalBar'])
      .optional(),
    data: z.string().optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Image Slide
const imageSlideSchema = z
  .object({
    title: titleSchema,
    caption: z.string().max(200).optional(),
    layout: z.enum(['full', 'left', 'right', 'center']).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Comparison Slide
// Same move as quote-slide: the four side fields are `required: true` in the
// field contract and were checked by the structural validator, which a singleton
// no longer owes. Requiring them here keeps the refine phase warning about a
// half-filled comparison.
const comparisonSlideSchema = z
  .object({
    title: requiredTitleSchema,
    leftTitle: z.string().min(1).max(80),
    leftBody: z.string().min(1).max(800),
    rightTitle: z.string().min(1).max(80),
    rightBody: z.string().min(1).max(800),
    background: backgroundSchema,
  })
  .passthrough();

// Matrix Slide (2x2 grid)
const matrixSlideSchema = z
  .object({
    title: requiredTitleSchema,
    topLeftTitle: z.string().max(80).optional(),
    topLeftBody: z.string().max(200).optional(),
    topRightTitle: z.string().max(80).optional(),
    topRightBody: z.string().max(200).optional(),
    bottomLeftTitle: z.string().max(80).optional(),
    bottomLeftBody: z.string().max(200).optional(),
    bottomRightTitle: z.string().max(80).optional(),
    bottomRightBody: z.string().max(200).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Video Slide
const videoSlideSchema = z
  .object({
    title: titleSchema,
    videoUrl: z.string().url().optional(),
    caption: z.string().max(200).optional(),
  })
  .passthrough();

// Team Cards Slide
const teamCardsSlideSchema = z
  .object({
    title: titleSchema,
    subheading: subheadingSchema,
    imageShape: z.enum(['rounded', 'square', 'circle']).optional(),
    members: z
      .array(
        z.object({
          image: z.string().optional(),
          name: z.string().max(80),
          byline: z.string().max(120),
        }),
      )
      .min(1)
      .max(25),
  })
  .passthrough();

// Logo Wall Slide
const logoWallSlideSchema = z
  .object({
    title: titleSchema,
    subheading: subheadingSchema,
    logos: z
      .array(
        z.object({
          image: z.string().optional(),
          name: z.string().max(80),
        }),
      )
      .min(1)
      // The array's own cap (the type declares maxItems: 30); the old 12 was
      // the legacy numbered family's ceiling, which no longer exists.
      .max(30),
  })
  .passthrough();

// Poll Slide
const pollSlideSchema = z
  .object({
    question: z.string().min(1).max(200),
    options: z.array(z.string().max(100)).min(2).max(6).optional(),
  })
  .passthrough();

// Likert Slide
const likertSlideSchema = z
  .object({
    question: z.string().min(1).max(200),
    leftLabel: z.string().max(50).optional(),
    rightLabel: z.string().max(50).optional(),
  })
  .passthrough();

// Feedback Slide
const feedbackSlideSchema = z
  .object({
    question: z.string().min(1).max(200),
    placeholder: z.string().max(100).optional(),
  })
  .passthrough();

// Image + Text Slide — title and body are the required content; the image and
// its many layout enums travel through untouched.
const imageTextSlideSchema = z
  .object({
    title: requiredTitleSchema,
    body: z.string().min(1).max(3000),
    caption: z.string().max(160).optional(),
    alt: z.string().max(180).optional(),
  })
  .passthrough();

// Embed Slide — an external URL in an iframe; embedUrl is the only required field.
const embedSlideSchema = z
  .object({
    title: titleSchema,
    embedUrl: z.string().min(1).max(500),
  })
  .passthrough();

// Countdown Slide — every field optional; the duration defaults when omitted.
const countdownSlideSchema = z
  .object({
    title: titleSchema,
    durationMinutes: z.number().min(0).max(60).optional(),
    durationSeconds: z.number().min(0).max(59).optional(),
    zeroText: z.string().max(60).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Likert Slider Slide — a single question with two endpoint labels.
const likertSliderSlideSchema = z
  .object({
    question: z.string().min(1).max(200),
    minLabel: z.string().max(120).optional(),
    maxLabel: z.string().max(120).optional(),
  })
  .passthrough();

// Process Slide — 3-7 ordered steps. `items` is canonical; `steps` is the
// legacy alias with the same shape (validated, not required, so an alias-only
// slide still passes).
const processSlideSchema = z
  .object({
    title: requiredTitleSchema,
    subheading: subheadingSchema,
    bottomSubheading: subheadingSchema,
    items: z.array(processItemSchema).min(3).max(7).optional(),
    steps: z.array(processItemSchema).min(3).max(7).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Funnel Slide — 3-6 stages. `items` canonical, `stages` legacy alias.
const funnelSlideSchema = z
  .object({
    title: requiredTitleSchema,
    subheading: subheadingSchema,
    bottomSubheading: subheadingSchema,
    items: z.array(funnelItemSchema).min(3).max(6).optional(),
    stages: z.array(funnelItemSchema).min(3).max(6).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Pyramid Slide — 3-6 levels; only `levels` exists (no alias).
const pyramidSlideSchema = z
  .object({
    title: requiredTitleSchema,
    subheading: subheadingSchema,
    bottomSubheading: subheadingSchema,
    levels: z.array(pyramidLevelSchema).min(3).max(6).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Cycle Slide — 3-6 items around a loop. `items` canonical, `stages` legacy alias.
const cycleSlideSchema = z
  .object({
    title: requiredTitleSchema,
    subheading: subheadingSchema,
    bottomSubheading: subheadingSchema,
    centerLabel: z.string().max(60).optional(),
    items: z.array(cycleItemSchema).min(3).max(6).optional(),
    stages: z.array(cycleItemSchema).min(3).max(6).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// Gallery Slide — 2-6 images; `images` is the required collection.
const gallerySlideSchema = z
  .object({
    title: titleSchema,
    subheading: subheadingSchema,
    bottomSubheading: subheadingSchema,
    images: z.array(galleryImageSchema).min(2).max(6),
    background: backgroundSchema,
  })
  .passthrough();

// End Slide — a closing card: title plus optional contact/social lines.
const endSlideSchema = z
  .object({
    title: requiredTitleSchema,
    body: z.string().max(500).optional(),
    contactName: z.string().max(80).optional(),
    contactEmail: z.string().max(120).optional(),
    contactUrl: z.string().max(200).optional(),
    background: backgroundSchema,
  })
  .passthrough();

// =============================================================================
// SCHEMA REGISTRY
// =============================================================================

// Keyed by type name. Coverage rule (the `refine-schema` companion in
// tests/helpers/slide-type-companions.js): every core type an agent can emit —
// i.e. every type that is NOT agent-opt-out (`deprecated` / `ai: false`) — owes
// a schema here. The refine phase only ever validates agent output, so a
// deprecated or withheld type never reaches this map; a missing entry for an
// offered type means its refined content is silently unvalidated. Both
// directions are gated by tests/slide-type-companion-coverage.test.js.
const SLIDE_SCHEMAS = {
  'title-slide': titleSlideSchema,
  'chapter-title-slide': chapterTitleSlideSchema,
  'quote-slide': quoteSlideSchema,
  'payoff-slide': payoffSlideSchema,
  'content-slide': contentSlideSchema,
  'list-slide': listSlideSchema,
  'timeline-slide': timelineSlideSchema,
  'kpi-metrics-slide': kpiMetricsSlideSchema,
  'icon-card-grid-slide': iconCardGridSlideSchema,
  'text-blocks-slide': textBlocksSlideSchema,
  'table-slide': tableSlideSchema,
  'chart-slide': chartSlideSchema,
  'image-slide': imageSlideSchema,
  'image-text-slide': imageTextSlideSchema,
  'comparison-slide': comparisonSlideSchema,
  'matrix-slide': matrixSlideSchema,
  'video-slide': videoSlideSchema,
  'embed-slide': embedSlideSchema,
  'countdown-slide': countdownSlideSchema,
  'team-cards-slide': teamCardsSlideSchema,
  'logo-wall-slide': logoWallSlideSchema,
  'gallery-slide': gallerySlideSchema,
  'poll-slide': pollSlideSchema,
  'likert-slide': likertSlideSchema,
  'likert-slider-slide': likertSliderSlideSchema,
  'feedback-slide': feedbackSlideSchema,
  'process-slide': processSlideSchema,
  'funnel-slide': funnelSlideSchema,
  'pyramid-slide': pyramidSlideSchema,
  'cycle-slide': cycleSlideSchema,
  'end-slide': endSlideSchema,
};

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate slide content against its type schema
 *
 * @param {string} type - Slide type name
 * @param {Object} content - Slide content object
 * @returns {Object} { valid: boolean, issues: Array<string> }
 */
export function validateSlideContent(type, content) {
  const schema = SLIDE_SCHEMAS[type];

  if (!schema) {
    // Unknown slide type - can't validate
    return {
      valid: true,
      issues: [],
      warning: `Unknown slide type: ${type}`,
    };
  }

  try {
    schema.parse(content);
    return { valid: true, issues: [] };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((e) => {
        const path = e.path.join('.');
        return `${path || 'root'}: ${e.message}`;
      });
      return { valid: false, issues };
    }
    return {
      valid: false,
      issues: [`Validation error: ${err.message}`],
    };
  }
}

/**
 * Safely parse and validate slide content
 * Returns the content if valid, or null with issues if invalid
 *
 * @param {string} type - Slide type name
 * @param {Object} content - Slide content object
 * @returns {Object} { data: Object|null, issues: Array<string> }
 */
export function safeParseSlideContent(type, content) {
  const schema = SLIDE_SCHEMAS[type];

  if (!schema) {
    return { data: content, issues: [] };
  }

  const result = schema.safeParse(content);
  if (result.success) {
    return { data: result.data, issues: [] };
  }

  const issues = result.error.issues.map((e) => {
    const path = e.path.join('.');
    return `${path || 'root'}: ${e.message}`;
  });

  return { data: null, issues };
}

// Export individual schemas for advanced use
export {
  titleSlideSchema,
  chapterTitleSlideSchema,
  quoteSlideSchema,
  payoffSlideSchema,
  contentSlideSchema,
  listSlideSchema,
  timelineSlideSchema,
  kpiMetricsSlideSchema,
  iconCardGridSlideSchema,
  textBlocksSlideSchema,
  tableSlideSchema,
  chartSlideSchema,
  SLIDE_SCHEMAS,
};
