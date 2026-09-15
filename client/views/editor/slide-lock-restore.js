/**
 * Take back a refused slide edit.
 *
 * Editing surfaces mutate `pres` before they call markDirty, so by the time
 * the slide lock manager refuses an edit (another user holds the slide) the
 * change is already in the local copy. Rather than guess the pre-edit state
 * locally — a remote update may have replaced the slide since it was last
 * seen — the slide is replaced with the server's copy, in the language
 * version being edited: the same fetch the remote update handler makes.
 */

import { normalizeLang } from '../../../shared/i18n-utils.js';

/**
 * @param {Object} deps
 * @param {Function} deps.api - API client
 * @param {string} deps.presentationId - Presentation ID
 * @param {Object} deps.pres - Shared mutable presentation reference
 * @param {string} deps.slideId - The slide whose local change is refused
 * @returns {Promise<boolean>} True when the local slide was replaced
 */
export async function restoreSlideFromServer({
  api,
  presentationId,
  pres,
  slideId,
} = {}) {
  if (!api || !presentationId || !pres || !slideId) return false;
  const active = normalizeLang(pres.i18n?.active);
  const langParam = active ? `?lang=${encodeURIComponent(active)}` : '';
  const fresh = await api(`/api/presentations/${presentationId}${langParam}`);
  const serverSlide = Array.isArray(fresh?.slides)
    ? fresh.slides.find((s) => s?.id === slideId)
    : null;
  const localIdx = Array.isArray(pres.slides)
    ? pres.slides.findIndex((s) => s?.id === slideId)
    : -1;
  if (!serverSlide || localIdx < 0) return false;
  if (typeof serverSlide.notes !== 'string') serverSlide.notes = '';
  pres.slides[localIdx] = serverSlide;
  return true;
}
