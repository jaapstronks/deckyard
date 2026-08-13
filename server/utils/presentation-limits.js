/**
 * Presentation size limits.
 * Enforces soft and hard limits on presentation size to prevent scaling issues.
 *
 * Soft limits: Warn the user but allow the operation
 * Hard limits: Block the operation with an error
 *
 * Configurable via environment variables:
 * - PRESENTATION_SOFT_SLIDE_LIMIT (default: 100)
 * - PRESENTATION_HARD_SLIDE_LIMIT (default: 500)
 * - PRESENTATION_SOFT_SIZE_MB (default: 10)
 * - PRESENTATION_HARD_SIZE_MB (default: 50)
 */

import { envInt } from '../config/utils.js';

/**
 * Get the current limit configuration from environment variables.
 * @returns {Object} Limits configuration
 */
function getLimits() {
  return {
    softSlideLimit: envInt('PRESENTATION_SOFT_SLIDE_LIMIT', 100, { min: 1 }),
    hardSlideLimit: envInt('PRESENTATION_HARD_SLIDE_LIMIT', 500, { min: 1 }),
    softSizeMb: envInt('PRESENTATION_SOFT_SIZE_MB', 10, { min: 1 }),
    hardSizeMb: envInt('PRESENTATION_HARD_SIZE_MB', 50, { min: 1 }),
  };
}

/**
 * Validation error/warning codes.
 */
const LimitCodes = {
  SLIDE_LIMIT_EXCEEDED: 'SLIDE_LIMIT_EXCEEDED',
  SLIDE_LIMIT_WARNING: 'SLIDE_LIMIT_WARNING',
  SIZE_LIMIT_EXCEEDED: 'SIZE_LIMIT_EXCEEDED',
  SIZE_LIMIT_WARNING: 'SIZE_LIMIT_WARNING',
};

/**
 * Calculate the approximate size of a presentation in bytes.
 * This is a rough estimate based on JSON serialization.
 * @param {Object} presentation - The presentation object
 * @returns {number} Size in bytes
 */
function estimatePresentationSize(presentation) {
  if (!presentation) return 0;
  try {
    // Estimate based on JSON size (actual storage may differ slightly)
    return JSON.stringify(presentation).length;
  } catch {
    return 0;
  }
}

/**
 * Convert bytes to megabytes.
 * @param {number} bytes - Size in bytes
 * @returns {number} Size in megabytes
 */
function bytesToMb(bytes) {
  return bytes / (1024 * 1024);
}

/**
 * Validate a presentation against size limits.
 * @param {Object} presentation - The presentation to validate
 * @param {Object} [options] - Options
 * @param {boolean} [options.skipSlideCheck] - Skip slide count check
 * @param {boolean} [options.skipSizeCheck] - Skip size check
 * @returns {Object} Validation result with ok, errors, warnings, and stats
 */
export function validatePresentationSize(presentation, options = {}) {
  const limits = getLimits();
  const errors = [];
  const warnings = [];

  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];
  const slideCount = slides.length;

  // Count total slides including i18n versions
  let totalSlideCount = slideCount;
  const i18nVersions = presentation?.i18n?.versions;
  if (i18nVersions && typeof i18nVersions === 'object') {
    for (const lang of Object.keys(i18nVersions)) {
      const version = i18nVersions[lang];
      if (version?.slides && Array.isArray(version.slides)) {
        totalSlideCount += version.slides.length;
      }
    }
  }

  // Slide count validation
  if (!options.skipSlideCheck) {
    if (slideCount > limits.hardSlideLimit) {
      errors.push({
        code: LimitCodes.SLIDE_LIMIT_EXCEEDED,
        message: `Presentation exceeds maximum slide limit (${slideCount}/${limits.hardSlideLimit} slides).`,
        current: slideCount,
        limit: limits.hardSlideLimit,
      });
    } else if (slideCount > limits.softSlideLimit) {
      warnings.push({
        code: LimitCodes.SLIDE_LIMIT_WARNING,
        message: `Presentation is approaching slide limit (${slideCount}/${limits.hardSlideLimit} slides). Consider splitting into multiple presentations.`,
        current: slideCount,
        softLimit: limits.softSlideLimit,
        hardLimit: limits.hardSlideLimit,
      });
    }
  }

  // Size validation
  if (!options.skipSizeCheck) {
    const sizeBytes = estimatePresentationSize(presentation);
    const sizeMb = bytesToMb(sizeBytes);

    if (sizeMb > limits.hardSizeMb) {
      errors.push({
        code: LimitCodes.SIZE_LIMIT_EXCEEDED,
        message: `Presentation exceeds maximum size limit (${sizeMb.toFixed(1)}MB/${limits.hardSizeMb}MB).`,
        currentMb: sizeMb,
        limitMb: limits.hardSizeMb,
      });
    } else if (sizeMb > limits.softSizeMb) {
      warnings.push({
        code: LimitCodes.SIZE_LIMIT_WARNING,
        message: `Presentation is approaching size limit (${sizeMb.toFixed(1)}MB/${limits.hardSizeMb}MB). Consider optimizing images.`,
        currentMb: sizeMb,
        softLimitMb: limits.softSizeMb,
        hardLimitMb: limits.hardSizeMb,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    stats: {
      slideCount,
      totalSlideCount,
      sizeBytes: options.skipSizeCheck ? undefined : estimatePresentationSize(presentation),
    },
  };
}

