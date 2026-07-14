/**
 * Zod Schemas for AI Outline Generation (Phase 1)
 *
 * These schemas validate the structure of Phase 1 AI output before
 * it's passed to Phase 2 for refinement.
 */

import { z } from 'zod';

// =============================================================================
// OUTLINE SLIDE SCHEMA
// =============================================================================

/**
 * Valid intent values for outline slides
 */
const intentSchema = z.enum(['opening', 'chapter', 'content', 'quote', 'closing']);

/**
 * Schema for a single slide in the outline
 */
export const outlineSlideSchema = z.object({
  intent: intentSchema,
  roughContent: z.string().min(1).max(5000),
  hints: z.array(z.string().max(50)).max(10).optional(),
  groupId: z.string().max(50).nullable().optional(),
});

// =============================================================================
// OUTLINE RESPONSE SCHEMA
// =============================================================================

/**
 * Complete Phase 1 outline response schema
 */
export const outlineResponseSchema = z.object({
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  summary: z.string().max(1000).optional(),
  statusMessages: z.array(z.string().max(200)).max(20).optional(),
  slides: z.array(outlineSlideSchema).min(1).max(100),
});

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate a Phase 1 outline response
 *
 * @param {Object} response - Raw AI response object
 * @returns {Object} { valid: boolean, issues: Array<string>, data: Object|null }
 */
export function validateOutlineResponse(response) {
  const result = outlineResponseSchema.safeParse(response);

  if (result.success) {
    return {
      valid: true,
      issues: [],
      data: result.data,
    };
  }

  const issues = result.error.errors.map((e) => {
    const path = e.path.join('.');
    return `${path || 'root'}: ${e.message}`;
  });

  return {
    valid: false,
    issues,
    data: null,
  };
}

/**
 * Validate a single outline slide
 *
 * @param {Object} slide - Slide object from outline
 * @returns {Object} { valid: boolean, issues: Array<string> }
 */
export function validateOutlineSlide(slide) {
  const result = outlineSlideSchema.safeParse(slide);

  if (result.success) {
    return { valid: true, issues: [] };
  }

  const issues = result.error.errors.map((e) => {
    const path = e.path.join('.');
    return `${path || 'root'}: ${e.message}`;
  });

  return { valid: false, issues };
}

/**
 * Known hint values for content slides
 * Used for validation and documentation
 */
export const KNOWN_HINTS = [
  'has-2-items',
  'has-3-items',
  'has-4-items',
  'has-5-items',
  'has-6-items',
  'has-7-items',
  'has-8-items',
  'is-timeline',
  'is-list-with-explanations',
  'has-numeric-data',
  'has-cause-effect',
  'has-comparison',
  'has-matrix',
  'has-pyramid',
  'has-funnel',
  'has-cycle',
  'has-process',
  'has-history',
];

/**
 * Check if hints are all valid known hints (warning only)
 *
 * @param {Array<string>} hints - Hint strings from outline
 * @returns {Array<string>} Unknown hints
 */
export function getUnknownHints(hints) {
  if (!Array.isArray(hints)) return [];
  return hints.filter((h) => {
    // Accept has-N-items pattern
    if (/^has-\d+-items$/.test(h)) return false;
    return !KNOWN_HINTS.includes(h);
  });
}
