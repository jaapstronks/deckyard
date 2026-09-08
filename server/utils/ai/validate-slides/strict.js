/**
 * Strict validation.
 *
 * Throwing validation for raw (unfixed) slides. Unlike the fix pipeline this
 * does not mutate input; it throws RawSlideValidationError on the first issue
 * with structured detail so MCP callers can pinpoint the failure without
 * parsing prose.
 *
 * There is one check here, not four: the type resolves against the caller's
 * registry, and the content matches the schema derived from that type's
 * `fields[]` (`schemas/content-schema.js`, D87). The item counts and text caps
 * this file used to enforce from its own tables are the same declarations, read
 * once instead of transcribed.
 */

import {
  describeIssue,
  validateSlideContent,
} from '../schemas/content-schema.js';
import {
  SLIDE_TYPES,
  resolveSlideTypeName,
} from '../../../../shared/slide-types/registry.js';

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
 * @param {Object} slide - { type, content, notes? }
 * @param {number} index - Slide index in the raw input array (for error reporting)
 * @param {{slideTypes: Record<string, Object>, theme: Object|null}} ctx
 */
function validateSlideStrict(slide, index, { slideTypes, theme }) {
  const rawType = slide?.type;
  const content = slide?.content;

  if (!rawType || typeof rawType !== 'string') {
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: null,
      field: 'type',
      expected: 'non-empty string',
      got: rawType,
      message: `Slide ${index}: missing or invalid "type"`,
    });
  }

  // Accept any spelling of a known type (bare key, core/…, canonical id) and
  // validate against the resolved registry key from here on. The registry is
  // the caller's, so an organization's DB-backed type is a known type here
  // exactly when the caller built its map with it.
  const type = resolveSlideTypeName(rawType, slideTypes);
  if (!type) {
    throw new RawSlideValidationError({
      slideIndex: index,
      slideType: rawType,
      field: 'type',
      expected: 'known slide type (see get_slide_types)',
      got: rawType,
      message: `Slide ${index}: unknown slide type "${rawType}"`,
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

  const { valid, issues } = validateSlideContent(slideTypes[type], content, {
    theme,
  });
  if (valid) return;

  const detail = describeIssue(issues[0], content);
  throw new RawSlideValidationError({
    slideIndex: index,
    slideType: type,
    field: detail.field,
    expected: detail.expected,
    got: detail.got,
    message: `Slide ${index} (${type}): ${detail.message}`,
  });
}

/**
 * Strictly validate raw slides. Throws RawSlideValidationError on the first
 * failure with structured detail. Does not mutate inputs.
 *
 * @param {Array<{type: string, content: object}>} slides
 * @param {Object} [options]
 * @param {Record<string, Object>} [options.slideTypes] - The registry to
 *   resolve against. Defaults to the process-wide map; an org-aware caller
 *   passes `buildMergedSlideTypes(ctx)` so its DB-backed types are known too.
 * @param {Object|null} [options.theme] - The deck's theme, when the caller has
 *   one. Only the `background` field reads it (D88).
 */
export function validateRefinedSlidesStrict(
  slides,
  { slideTypes = SLIDE_TYPES, theme = null } = {},
) {
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
    validateSlideStrict(slides[i], i, { slideTypes, theme });
  }
}
