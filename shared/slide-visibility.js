/**
 * Slide visibility utilities.
 *
 * Each slide can have a `visibility` object controlling where it appears:
 * - hideInPresentation: true = skip in presenter mode
 * - hideInExport: true = exclude from PDF/print exports
 * - hideInPublished: true = exclude from published pages and embeds
 * - hideFromViewers: true = hide from view-only collaborators
 *
 * Missing `visibility` or missing flags default to false (visible everywhere).
 */

/**
 * Visibility presets with their flag configurations.
 * These provide user-friendly names for common combinations.
 */
export const VISIBILITY_PRESETS = {
  visible: {
    hideInPresentation: false,
    hideInExport: false,
    hideInPublished: false,
    hideFromViewers: false,
  },
  draft: {
    hideInPresentation: true,
    hideInExport: true,
    hideInPublished: true,
    hideFromViewers: false, // Draft slides visible to collaborators with badge
  },
  internal: {
    hideInPresentation: false,
    hideInExport: true,
    hideInPublished: true,
    hideFromViewers: false,
  },
  hidden: {
    hideInPresentation: true,
    hideInExport: true,
    hideInPublished: true,
    hideFromViewers: true,
  },
  skipInPresentation: {
    hideInPresentation: true,
    hideInExport: false,
    hideInPublished: false,
    hideFromViewers: false,
  },
};

/**
 * Get the visibility flags for a slide with defaults applied.
 * @param {Object} slide - The slide object
 * @returns {Object} Visibility flags with defaults (all false if missing)
 */
export function getSlideVisibility(slide) {
  const v = slide?.visibility;
  if (!v || typeof v !== 'object') {
    return {
      hideInPresentation: false,
      hideInExport: false,
      hideInPublished: false,
      hideFromViewers: false,
    };
  }
  return {
    hideInPresentation: !!v.hideInPresentation,
    hideInExport: !!v.hideInExport,
    hideInPublished: !!v.hideInPublished,
    hideFromViewers: !!v.hideFromViewers,
  };
}

/**
 * Determine which preset matches the slide's visibility flags.
 * Returns the preset name or 'custom' if no preset matches.
 * @param {Object} slide - The slide object
 * @returns {string} Preset name: 'visible', 'draft', 'internal', 'hidden', 'skipInPresentation', or 'custom'
 */
export function getVisibilityPreset(slide) {
  const v = getSlideVisibility(slide);

  for (const [presetName, presetFlags] of Object.entries(VISIBILITY_PRESETS)) {
    if (
      v.hideInPresentation === presetFlags.hideInPresentation &&
      v.hideInExport === presetFlags.hideInExport &&
      v.hideInPublished === presetFlags.hideInPublished &&
      v.hideFromViewers === presetFlags.hideFromViewers
    ) {
      return presetName;
    }
  }

  return 'custom';
}

/**
 * Check if a slide is visible in a given context.
 * @param {Object} slide - The slide object
 * @param {string} context - One of: 'presentation', 'export', 'published', 'viewer'
 * @param {Object} options - Additional options
 * @param {string} options.userPermission - User's permission level (e.g., 'read', 'write')
 * @returns {boolean} True if the slide should be shown in this context
 */
export function isSlideVisibleIn(slide, context, options = {}) {
  const v = getSlideVisibility(slide);

  switch (context) {
    case 'presentation':
      return !v.hideInPresentation;
    case 'export':
      return !v.hideInExport;
    case 'published':
      return !v.hideInPublished;
    case 'viewer':
      // View-only users: hide slides with hideFromViewers
      // Note: 'read' permission means view-only
      if (options.userPermission === 'read') {
        return !v.hideFromViewers;
      }
      // Editors and above see everything
      return true;
    default:
      return true;
  }
}

/**
 * Check if a slide is a draft (visible to collaborators but marked as work-in-progress).
 * @param {Object} slide - The slide object
 * @returns {boolean} True if this is a draft slide
 */
export function isDraftSlide(slide) {
  return getVisibilityPreset(slide) === 'draft';
}

/**
 * Filter slides for a specific context.
 * @param {Array} slides - Array of slide objects
 * @param {string} context - One of: 'presentation', 'export', 'published', 'viewer'
 * @param {Object} options - Additional options
 * @param {string} options.userPermission - User's permission level
 * @param {boolean} options.markDrafts - If true, adds _isDraft flag to draft slides (for viewer context)
 * @returns {Array} Filtered array of slides
 */
export function filterSlidesForContext(slides, context, options = {}) {
  if (!Array.isArray(slides)) return [];

  const filtered = slides.filter((s) => isSlideVisibleIn(s, context, options));

  // For viewer context, mark draft slides so UI can show a badge
  if (options.markDrafts && context === 'viewer') {
    return filtered.map((s) => {
      if (isDraftSlide(s)) {
        return { ...s, _isDraft: true };
      }
      return s;
    });
  }

  return filtered;
}

/**
 * Apply a visibility preset to a slide.
 * @param {Object} slide - The slide object (will be mutated)
 * @param {string} presetName - The preset name to apply
 * @returns {Object} The slide with updated visibility
 */
export function applyVisibilityPreset(slide, presetName) {
  const preset = VISIBILITY_PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown visibility preset: ${presetName}`);
  }
  slide.visibility = { ...preset };
  return slide;
}

/**
 * Get human-readable info about a visibility preset.
 * @param {string} presetName - The preset name
 * @returns {Object} Object with contexts array showing where slide is visible
 */
export function getPresetInfo(presetName) {
  const preset = VISIBILITY_PRESETS[presetName];
  if (!preset) return null;

  return {
    name: presetName,
    showInPresentation: !preset.hideInPresentation,
    showInExport: !preset.hideInExport,
    showInPublished: !preset.hideInPublished,
    showToViewers: !preset.hideFromViewers,
  };
}

/**
 * Validate visibility object structure.
 * @param {Object} visibility - The visibility object to validate
 * @returns {Array<string>} Array of error messages (empty if valid)
 */
export function validateVisibility(visibility) {
  const errors = [];

  if (visibility == null) {
    // Missing visibility is valid (defaults to all-visible)
    return errors;
  }

  if (typeof visibility !== 'object') {
    errors.push('Slide.visibility must be an object');
    return errors;
  }

  const allowedKeys = ['hideInPresentation', 'hideInExport', 'hideInPublished', 'hideFromViewers'];
  for (const key of Object.keys(visibility)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`Slide.visibility contains unknown key: ${key}`);
    }
  }

  for (const key of allowedKeys) {
    if (visibility[key] != null && typeof visibility[key] !== 'boolean') {
      errors.push(`Slide.visibility.${key} must be a boolean`);
    }
  }

  return errors;
}
