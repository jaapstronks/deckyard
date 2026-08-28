/**
 * Keep the selected slide reflected in the URL (?slideId=) so a refresh or a
 * shared link reopens the editor/viewer on that slide.
 *
 * A named wrapper over the router's `setQueryParams` (which replaces rather
 * than pushes, so there is no history entry per slide and no re-route): this
 * file is where "the selected slide lives in `?slideId=`" is written down. The
 * load side lives in the controllers (?slideId= / ?s= → initialSlideId).
 */
import { setQueryParams } from '../../lib/state/router.js';

/**
 * Write the selected slide id into the current URL.
 * @param {string|null} slideId - Selected slide id; falsy removes the param.
 */
export function syncSlideIdInUrl(slideId) {
  setQueryParams({
    slideId: slideId || null,
    // `s` is a read-only alias on load; drop it so the two can't disagree.
    s: null,
  });
}
