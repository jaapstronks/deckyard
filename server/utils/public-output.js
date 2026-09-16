// Helpers for outputs that must not include "live-only" slides.

import { filterSlidesForContext } from '../../shared/slide-visibility.js';
import { getSlideType } from '../../shared/slide-types/registry.js';

/**
 * Drop the slides whose type declares `liveOnly: true` — content that only
 * means something while a session is running (the follow-along invite).
 * A declaration on the type, not a list of names here, so a fork type can say
 * the same thing.
 * @param {Object} pres - Presentation object
 * @returns {Object} the presentation, unchanged when nothing was live-only
 */
export function stripLiveOnlySlidesFromPresentation(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  const slides = Array.isArray(pres.slides) ? pres.slides : [];
  const filtered = slides.filter(
    (s) =>
      !(s && typeof s === 'object' && getSlideType(s.type)?.liveOnly === true),
  );
  // Avoid cloning big objects unless we actually changed something.
  if (filtered.length === slides.length) return pres;
  return { ...pres, slides: filtered };
}

/**
 * Filter presentation for export context (PDF, standalone HTML, etc.).
 * Removes live-only slides and slides with hideInExport visibility.
 * @param {Object} pres - Presentation object
 * @returns {Object} Filtered presentation
 */
export function filterForExport(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  // First strip live-only slides
  pres = stripLiveOnlySlidesFromPresentation(pres);
  // Then apply visibility filter for export context
  const slides = Array.isArray(pres.slides) ? pres.slides : [];
  const filtered = filterSlidesForContext(slides, 'export');
  if (filtered.length === slides.length) return pres;
  return { ...pres, slides: filtered };
}

/**
 * Filter presentation for published/public context (embed, /p/ pages).
 * Removes live-only slides and slides with hideInPublished visibility.
 * @param {Object} pres - Presentation object
 * @returns {Object} Filtered presentation
 */
export function filterForPublished(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  // First strip live-only slides
  pres = stripLiveOnlySlidesFromPresentation(pres);
  // Then apply visibility filter for published context
  const slides = Array.isArray(pres.slides) ? pres.slides : [];
  const filtered = filterSlidesForContext(slides, 'published');
  if (filtered.length === slides.length) return pres;
  return { ...pres, slides: filtered };
}

/**
 * Filter presentation for view-only users.
 * Removes slides with hideFromViewers visibility and marks draft slides.
 * @param {Object} pres - Presentation object
 * @param {Object} options - Options
 * @param {boolean} options.markDrafts - Whether to mark draft slides with _isDraft flag
 * @returns {Object} Filtered presentation
 */
export function filterForViewOnly(pres, options = {}) {
  if (!pres || typeof pres !== 'object') return pres;
  const slides = Array.isArray(pres.slides) ? pres.slides : [];
  const filtered = filterSlidesForContext(slides, 'viewer', {
    userPermission: 'read',
    markDrafts: options.markDrafts !== false,
  });
  if (filtered.length === slides.length && !options.markDrafts) return pres;
  return { ...pres, slides: filtered };
}
