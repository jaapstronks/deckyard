/**
 * Alt text management utilities for image fields
 * Handles updating alt text in both active and other language buffers
 */

/**
 * Create an alt setter function for a specific slide field
 * @param {Object} options - Configuration options
 * @param {Object} options.slide - The slide object
 * @param {Object} options.pres - The presentation object
 * @param {Function} options.normalizeLang - Language normalizer function
 * @param {string} options.activeLang - The active language
 * @param {string} options.fieldKey - The content field key for the alt text (e.g., 'alt', 'bgAlt')
 * @returns {Function} A function that sets alt text for a given language
 */
export function createAltSetter({ slide, pres, normalizeLang, activeLang, fieldKey }) {
  return (lang, alt) => {
    const l = normalizeLang?.(lang);
    if (!l) return;

    // If this language is the active editor buffer, update the slide object directly.
    if (l === activeLang) {
      slide.content = slide.content && typeof slide.content === 'object' ? slide.content : {};
      slide.content[fieldKey] = typeof alt === 'string' ? alt : '';
      return;
    }

    // Otherwise, only update if the other language version exists locally.
    const ver = pres?.i18n?.versions?.[l];
    const slides = Array.isArray(ver?.slides) ? ver.slides : null;
    if (!slides) return;
    const tgt = slides.find((s) => s?.id === slide?.id);
    if (!tgt) return;
    tgt.content = tgt.content && typeof tgt.content === 'object' ? tgt.content : {};
    tgt.content[fieldKey] = typeof alt === 'string' ? alt : '';
  };
}

/**
 * Create an indexed alt setter for multi-image fields (e.g., logo1Alt, logo2Alt)
 * @param {Object} options - Configuration options
 * @param {Object} options.slide - The slide object
 * @param {Object} options.pres - The presentation object
 * @param {Function} options.normalizeLang - Language normalizer function
 * @param {string} options.activeLang - The active language
 * @param {string} options.fieldPrefix - The prefix for the field key (e.g., 'logo')
 * @returns {Function} A function that sets alt text for a given language and index
 */
export function createIndexedAltSetter({ slide, pres, normalizeLang, activeLang, fieldPrefix }) {
  return (lang, idx, alt) => {
    const l = normalizeLang?.(lang);
    if (!l) return;
    const key = `${fieldPrefix}${idx + 1}Alt`;

    // Only set if that key exists on the slide content (opt-in).
    if (!slide?.content || typeof slide.content !== 'object' || !(key in slide.content)) {
      return;
    }

    if (l === activeLang) {
      slide.content[key] = typeof alt === 'string' ? alt : '';
      return;
    }

    const ver = pres?.i18n?.versions?.[l];
    const slides = Array.isArray(ver?.slides) ? ver.slides : null;
    if (!slides) return;
    const tgt = slides.find((s) => s?.id === slide?.id);
    if (!tgt) return;
    tgt.content = tgt.content && typeof tgt.content === 'object' ? tgt.content : {};
    tgt.content[key] = typeof alt === 'string' ? alt : '';
  };
}

// Note: the former `applyAltFromLibraryItem` / `applyAltFromImageKitPick`
// helpers were unified into `applyAltFromPick` in `../../media/apply-pick.js`,
// which operates on the normalized picked-image contract from the picker seam.