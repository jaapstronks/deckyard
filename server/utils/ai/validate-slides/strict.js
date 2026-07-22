/**
 * Strict validation.
 *
 * Throwing validation for raw (unfixed) slides. Unlike the fix pipeline this
 * does not mutate input; it throws RawSlideValidationError on the first issue
 * with structured detail so MCP callers can pinpoint the failure without
 * parsing prose.
 */

import { validateSlideContent } from '../schemas/index.js';
import { SLIDE_TYPES } from '../../../../shared/slide-types/registry.js';
import {
  SLIDE_ITEM_REQUIREMENTS,
  STRICT_TEXT_LIMITS,
  STRICT_ITEM_LIMITS,
} from './constants.js';

/**
 * Strict validation error thrown by validateRefinedSlidesStrict.
 * Carries structured detail so MCP callers can pinpoint the first failure
 * without parsing prose error messages.
 */
export class RawSlideValidationError extends Error {
  constructor({ slideIndex, slideType, field, expected, got, message }) {
    super(message);
    this.name = 'RawSlideValidationError';
    this.slideIndex = slideIndex;
    this.slideType = slideType;
    this.field = field;
    this.expected = expected;
    this.got = got;
    this.details = { slideIndex, slideType, field, expected, got, message };
  }
}

/**
 * Validate a single raw slide and throw RawSlideValidationError on first issue.
 *
 * Checks:
 * - slide.type exists in SLIDE_TYPES
 * - content matches Zod schema (when available for that type)
 * - item-bearing types meet min/max count requirements
 * - common text fields are within their max length
 *
 * @param {Object} slide - { type, content, notes? }
 * @param {number} index - Slide index in the raw input array (for error reporting)
 */
function validateSlideStrict(slide, index) {
  const type = slide?.type;
  const content = slide?.content;

  if (!type || typeof type !== 'string') {
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: null,
      field: 'type',
      expected: 'non-empty string',
      got: type,
      message: `Slide ${index}: missing or invalid "type"`,
    });
  }

  if (!SLIDE_TYPES[type]) {
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: type,
      field: 'type',
      expected: 'known slide type (see get_slide_types)',
      got: type,
      message: `Slide ${index}: unknown slide type "${type}"`,
    });
  }

  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: type,
      field: 'content',
      expected: 'object',
      got: Array.isArray(content) ? 'array' : typeof content,
      message: `Slide ${index}: "content" must be an object`,
    });
  }

  // Item count (min/max)
  const req = SLIDE_ITEM_REQUIREMENTS[type];
  if (req) {
    const arr = content[req.field];
    if (!Array.isArray(arr)) {
      throw new RawSlideValidationError({
        slideIndex: index,
        slideType: type,
        field: req.field,
        expected: `array with ${req.min}–${req.max} items`,
        got: arr === undefined ? 'undefined' : typeof arr,
        message: `Slide ${index} (${type}): "${req.field}" must be an array`,
      });
    }
    if (arr.length < req.min) {
      throw new RawSlideValidationError({
        slideIndex: index,
        slideType: type,
        field: req.field,
        expected: `minItems ${req.min}`,
        got: arr.length,
        message: `Slide ${index} (${type}): "${req.field}" requires at least ${req.min} items (got ${arr.length})`,
      });
    }
    if (req.max && arr.length > req.max) {
      throw new RawSlideValidationError({
        slideIndex: index,
        slideType: type,
        field: req.field,
        expected: `maxItems ${req.max}`,
        got: arr.length,
        message: `Slide ${index} (${type}): "${req.field}" allows at most ${req.max} items (got ${arr.length})`,
      });
    }
  }

  // Common text-field length caps
  for (const [field, max] of Object.entries(STRICT_TEXT_LIMITS)) {
    const v = content[field];
    if (typeof v === 'string' && v.length > max) {
      throw new RawSlideValidationError({
        slideIndex: index,
        slideType: type,
        field,
        expected: `maxLength ${max}`,
        got: v.length,
        message: `Slide ${index} (${type}): "${field}" exceeds max length (${v.length} > ${max})`,
      });
    }
  }

  // Array-item text caps (items[].title / text / time)
  if (Array.isArray(content.items)) {
    content.items.forEach((item, itemIdx) => {
      if (!item || typeof item !== 'object') return;
      for (const [field, max] of Object.entries(STRICT_ITEM_LIMITS)) {
        const v = item[field];
        if (typeof v === 'string' && v.length > max) {
          throw new RawSlideValidationError({
            slideIndex: index,
            slideType: type,
            field: `items[${itemIdx}].${field}`,
            expected: `maxLength ${max}`,
            got: v.length,
            message: `Slide ${index} (${type}): items[${itemIdx}].${field} exceeds max length (${v.length} > ${max})`,
          });
        }
      }
    });
  }

  // Zod schema (defense in depth). Only enforced when a schema is registered
  // for this type; unknown-to-Zod types fall back to the checks above.
  const zod = validateSlideContent(type, content);
  if (!zod.valid && zod.issues.length > 0) {
    const first = zod.issues[0];
    const [pathPart, ...rest] = first.split(':');
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: type,
      field: pathPart.trim(),
      expected: 'schema match',
      got: rest.join(':').trim(),
      message: `Slide ${index} (${type}): ${first}`,
    });
  }
}

/**
 * Strictly validate raw slides. Throws RawSlideValidationError on the first
 * failure with structured detail. Does not mutate inputs.
 *
 * @param {Array<{type: string, content: object}>} slides
 */
export function validateRefinedSlidesStrict(slides) {
  if (!Array.isArray(slides)) {
    throw new RawSlideValidationError({
      slideIndex: -1,
      slideType: null,
      field: 'slides',
      expected: 'array',
      got: typeof slides,
      message: '"slides" must be an array',
    });
  }
  if (slides.length === 0) {
    throw new RawSlideValidationError({
      slideIndex: -1,
      slideType: null,
      field: 'slides',
      expected: 'array with at least 1 slide',
      got: 0,
      message: '"slides" must contain at least 1 slide',
    });
  }
  for (let i = 0; i < slides.length; i++) {
    validateSlideStrict(slides[i], i);
  }
}
