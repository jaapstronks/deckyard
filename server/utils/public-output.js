// Helpers for outputs that must not include "live-only" slides.

import { filterSlidesForContext } from '../../shared/slide-visibility.js';
import { isLiveOnlySlideType } from '../../shared/slide-types/live-session.js';
import { isFeatureEnabled } from '../config/flags-snapshot.js';

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
    (s) => !(s && typeof s === 'object' && isLiveOnlySlideType(s.type)),
  );
  // Avoid cloning big objects unless we actually changed something.
  if (filtered.length === slides.length) return pres;
  return { ...pres, slides: filtered };
}

/**
 * The first slide an output that outlives the session can show: what the
 * preview image of a published or shared deck is rendered from. The same
 * `liveOnly` declaration as the strip above, asked once instead of by three
 * callers in their own words (B413).
 * @param {Object} pres - Presentation object
 * @returns {Object|null} the slide, or `null` when every slide is live-only
 */
export function firstPublicSlide(pres) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  return (
    slides.find(
      (s) => s && typeof s === 'object' && !isLiveOnlySlideType(s.type),
    ) || null
  );
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
 * Apply `fn` to every slide list a deck carries: `slides` and the `slides` of
 * each language version in `i18n.versions`. A reader-facing filter that only
 * touched `slides` would leave the same slides readable in every other
 * version of the response (B698).
 * @param {Object} pres - Presentation object
 * @param {(slides: Object[]) => Object[]} fn - returns the list to serve;
 *   the same array when nothing changed
 * @returns {Object} the presentation, unchanged when `fn` changed no list
 */
export function mapDeckSlideLists(pres, fn) {
  if (!pres || typeof pres !== 'object') return pres;
  let changed = false;
  const apply = (owner) => {
    if (!owner || typeof owner !== 'object' || !Array.isArray(owner.slides)) {
      return owner;
    }
    const slides = fn(owner.slides);
    if (slides === owner.slides) return owner;
    changed = true;
    return { ...owner, slides };
  };
  const next = apply(pres);
  const versions = pres.i18n?.versions;
  if (!versions || typeof versions !== 'object') return changed ? next : pres;
  const nextVersions = Object.fromEntries(
    Object.entries(versions).map(([lang, version]) => [lang, apply(version)]),
  );
  if (!changed) return pres;
  return { ...next, i18n: { ...pres.i18n, versions: nextVersions } };
}

/**
 * Filter presentation for view-only users, in every language version it
 * carries. Removes slides with hideFromViewers visibility and marks draft
 * slides.
 * @param {Object} pres - Presentation object
 * @param {Object} options - Options
 * @param {boolean} options.markDrafts - Whether to mark draft slides with _isDraft flag
 * @returns {Object} Filtered presentation
 */
export function filterForViewOnly(pres, options = {}) {
  return mapDeckSlideLists(pres, (slides) => {
    const filtered = filterSlidesForContext(slides, 'viewer', {
      userPermission: 'read',
      markDrafts: options.markDrafts !== false,
    });
    if (filtered.length === slides.length && !options.markDrafts) return slides;
    return filtered;
  });
}

/**
 * The deck an anonymous share viewer gets (`/s/:token`): the view-only filter
 * with drafts badged, and with the live cluster off no live-only slide either.
 * The viewer has no feature snapshot, so the server's answer is what it
 * serves (D260, as `tracking` carries the analytics answer): an invite into a
 * session nothing can start does not leave. A signed-in reader keeps the
 * slide in its static form and asks its snapshot.
 * @param {Object} pres - Presentation object
 * @returns {Object} Filtered presentation
 */
export function filterForShareViewer(pres) {
  const visible = filterForViewOnly(pres, { markDrafts: true });
  return isFeatureEnabled('live')
    ? visible
    : stripLiveOnlySlidesFromPresentation(visible);
}
