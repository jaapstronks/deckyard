/**
 * Zod Schemas for Refined Slide Content
 *
 * These schemas validate the content structure of Phase 2 AI output.
 * They complement existing validation in validate-slides.js but provide
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

const lijstjeItemSchema = z.object({
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
const chapterTitleSlideSchema = z.object({
  title: requiredTitleSchema,
}).passthrough();

// Quote Slide (Phase 1 resolved)
const quoteSlideSchema = z.object({
  quote: z.string().min(1).max(280),
  authorName: z.string().max(80).optional(),
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

// Lijstje Slide (fancy list)
const lijstjeSlideSchema = z.object({
  title: requiredTitleSchema,
  subheading: z.string().max(160).optional(),
  variant: z.enum(['bullets', 'numbers']).optional(),
  layout: layoutSchema,
  items: z.array(lijstjeItemSchema).min(2).max(8),
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
const iconCardGridSlideSchema = z.object({
  title: requiredTitleSchema,
  subheading: subheadingSchema,
  cardCount: z.enum(['1', '2', '3', '4', '5', '6']),
  // Dynamic card fields validated separately
}).passthrough();

// Card Stack Slide
const cardStackSlideSchema = z.object({
  title: requiredTitleSchema,
  subheading: subheadingSchema,
  cardCount: z.enum(['1', '2', '3', '4']),
  // Dynamic card fields validated separately
}).passthrough();

// Text Blocks Slide
const textBlocksSlideSchema = z.object({
  title: requiredTitleSchema,
  subheading: subheadingSchema,
  row1Count: z.enum(['1', '2', '3', '4', '5', '6']),
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
}).passthrough();

// Content Columns Slide
const contentColumnsSlideSchema = z.object({
  title: titleSchema,
  columnCount: z.enum(['1', '2', '3', '4', '5', '6', '7']),
  background: backgroundSchema,
}).passthrough();

// Table Slide
const tableSlideSchema = z.object({
  title: titleSchema,
  colCount: z.string().optional(),
  headerRow: z.enum(['on', 'off']).optional(),
  rows: z.array(z.record(z.string())).optional(),
  background: backgroundSchema,
}).passthrough();

// Chart Slide
const chartSlideSchema = z.object({
  title: titleSchema,
  chartType: z.enum(['bar', 'line', 'pie', 'doughnut', 'horizontalBar']).optional(),
  data: z.string().optional(),
  background: backgroundSchema,
}).passthrough();

// Image Slide
const imageSlideSchema = z.object({
  title: titleSchema,
  caption: z.string().max(200).optional(),
  layout: z.enum(['full', 'left', 'right', 'center']).optional(),
  background: backgroundSchema,
}).passthrough();

// Comparison Slide
const comparisonSlideSchema = z.object({
  title: requiredTitleSchema,
  leftTitle: z.string().max(80).optional(),
  leftBody: z.string().max(800).optional(),
  rightTitle: z.string().max(80).optional(),
  rightBody: z.string().max(800).optional(),
  background: backgroundSchema,
}).passthrough();

// Matrix Slide (2x2 grid)
const matrixSlideSchema = z.object({
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
}).passthrough();

// Video Slide
const videoSlideSchema = z.object({
  title: titleSchema,
  videoUrl: z.string().url().optional(),
  caption: z.string().max(200).optional(),
}).passthrough();

// Team Cards Slide — accepts both members[] and legacy card{N} fields
const teamCardsSlideSchema = z.object({
  title: titleSchema,
  subheading: subheadingSchema,
  imageShape: z.enum(['rounded', 'square', 'circle']).optional(),
  members: z.array(z.object({
    image: z.string().optional(),
    name: z.string().max(80),
    byline: z.string().max(120),
  })).min(1).max(25).optional(),
  cardCount: z.enum(Array.from({ length: 25 }, (_v, i) => String(i + 1))).optional(),
}).passthrough();

// Logo Wall Slide — accepts both logos[] and legacy logo{N} fields
const logoWallSlideSchema = z.object({
  title: titleSchema,
  subheading: subheadingSchema,
  logos: z.array(z.object({
    image: z.string().optional(),
    name: z.string().max(80),
  })).min(1).max(12).optional(),
  logoCount: z.enum(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']).optional(),
}).passthrough();

// Poll Slide
const pollSlideSchema = z.object({
  question: z.string().min(1).max(200),
  options: z.array(z.string().max(100)).min(2).max(6).optional(),
}).passthrough();

// Likert Slide
const likertSlideSchema = z.object({
  question: z.string().min(1).max(200),
  leftLabel: z.string().max(50).optional(),
  rightLabel: z.string().max(50).optional(),
}).passthrough();

// Feedback Slide
const feedbackSlideSchema = z.object({
  question: z.string().min(1).max(200),
  placeholder: z.string().max(100).optional(),
}).passthrough();

// Follow Invite Slide
const followInviteSlideSchema = z.object({
  title: titleSchema,
  subheading: subheadingSchema,
}).passthrough();

// =============================================================================
// SCHEMA REGISTRY
// =============================================================================

const SLIDE_SCHEMAS = {
  'title-slide': titleSlideSchema,
  'chapter-title-slide': chapterTitleSlideSchema,
  'quote-slide': quoteSlideSchema,
  'payoff-slide': payoffSlideSchema,
  'content-slide': contentSlideSchema,
  'list-slide': lijstjeSlideSchema,
  'lijstje-slide': lijstjeSlideSchema, // Back-compat alias
  'timeline-slide': timelineSlideSchema,
  'kpi-metrics-slide': kpiMetricsSlideSchema,
  'icon-card-grid-slide': iconCardGridSlideSchema,
  'card-stack-slide': cardStackSlideSchema,
  'text-blocks-slide': textBlocksSlideSchema,
  'content-columns-slide': contentColumnsSlideSchema,
  'table-slide': tableSlideSchema,
  'chart-slide': chartSlideSchema,
  'image-slide': imageSlideSchema,
  'comparison-slide': comparisonSlideSchema,
  'matrix-slide': matrixSlideSchema,
  'video-slide': videoSlideSchema,
  'team-cards-slide': teamCardsSlideSchema,
  'logo-wall-slide': logoWallSlideSchema,
  'poll-slide': pollSlideSchema,
  'likert-slide': likertSlideSchema,
  'feedback-slide': feedbackSlideSchema,
  'follow-invite-slide': followInviteSlideSchema,
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
      const issues = err.errors.map((e) => {
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

  const issues = result.error.errors.map((e) => {
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
  lijstjeSlideSchema,
  timelineSlideSchema,
  kpiMetricsSlideSchema,
  iconCardGridSlideSchema,
  cardStackSlideSchema,
  textBlocksSlideSchema,
  contentColumnsSlideSchema,
  tableSlideSchema,
  chartSlideSchema,
  SLIDE_SCHEMAS,
};
