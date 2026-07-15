/**
 * If-Match revision for the editor's side routes (scope change, version
 * restore).
 *
 * With live collab edits on (features.collab + collabLiveEdits) the deck
 * revision is bumped server-side by every debounced collab store, but the
 * editor never adopts those bumps into its own `pres.revision` (revision is
 * a server-managed key the doc binder deliberately leaves alone). Sending
 * that stale value would 409 any If-Match-guarded route after the first
 * couple of edits in a session.
 *
 * Fix: fetch the current revision right before the guarded call. Reading it
 * from the collab doc instead would NOT be correct — the doc's `revision`
 * extra is only refreshed by server-side writes (live-apply), not by the
 * client-driven collab stores that dominate a live session. And relaxing
 * If-Match server-side would weaken the flag-off contract. The tiny
 * fetch-to-PATCH window this leaves is no wider than any client-held
 * revision ever was, and the guard itself still runs server-side.
 *
 * With the flag off this is a pass-through of `pres.revision` — the
 * autosave/If-Match flow keeps it fresh there.
 */

import { getFeatures } from '../../lib/features.js';

/**
 * Resolve the If-Match header value for a guarded presentation route,
 * refreshing `pres.revision` from the server first when live collab edits
 * are active.
 *
 * @param {Object} opts
 * @param {Function} opts.api - API helper
 * @param {string} opts.id - Presentation id
 * @param {Object} opts.pres - The editor's presentation object (revision is
 *   updated in place on refresh)
 * @returns {Promise<string>} Header value for `If-Match`
 */
export async function ifMatchRevision({ api, id, pres }) {
  const features = getFeatures() || {};
  if (features.collab && features.collabLiveEdits) {
    try {
      const current = await api(`/api/presentations/${id}`);
      const revision = Number(current?.revision);
      if (Number.isFinite(revision) && revision > 0 && pres) {
        pres.revision = revision;
      }
    } catch {
      // Fall back to the local revision; the server-side guard still runs.
    }
  }
  return String(Number(pres?.revision) || 1);
}
