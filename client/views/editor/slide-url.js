/**
 * Keep the selected slide reflected in the URL (?slideId=) so a refresh or a
 * shared link reopens the editor/viewer on that slide.
 *
 * Uses replaceState — no history entry per slide — and preserves all other
 * query params (lang, …). The router matches on pathname only, so a
 * query-only replaceState never triggers a re-route. The load side lives in
 * the controllers (?slideId= / ?s= → initialSlideId).
 */

/**
 * Write the selected slide id into the current URL.
 * @param {string|null} slideId - Selected slide id; falsy removes the param.
 */
export function syncSlideIdInUrl(slideId) {
  try {
    const u = new URL(location.href);
    if (slideId) {
      u.searchParams.set('slideId', slideId);
    } else {
      u.searchParams.delete('slideId');
    }
    // `s` is a read-only alias on load; drop it so the two can't disagree.
    u.searchParams.delete('s');
    history.replaceState(history.state, '', u.toString());
  } catch {
    // URL/history unavailable (tests, exotic embeds); selection still works.
  }
}
