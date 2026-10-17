/**
 * Slide Update Handler
 * Listens for SSE `presentation:updated` events and merges remote changes
 * into the local editor state without disrupting editing or triggering autosave.
 */
import { toast } from '../../lib/dom/toast.js';
import { matchesIdentity } from '../../../shared/identity-match.js';

/**
 * Merge a refetched deck into the local slides. The server's slide order is
 * authoritative, so a slide a colleague inserted or moved lands where it
 * stands on the server, not at the end. Content: the slide this user has
 * locked keeps its local version; with `modifiedIds` the other slides the
 * colleague did not touch keep theirs too (they may carry pending local
 * edits), without it every remote version is adopted. Slides the server no
 * longer has are dropped.
 *
 * @param {Array<Object>} localSlides - The editor's current slides
 * @param {Array<Object>} remoteSlides - The refetched deck's slides, in order
 * @param {Object} [opts]
 * @param {string|null} [opts.lockedSlideId] - Slide locked by this user
 * @param {string[]} [opts.modifiedIds] - Slides the remote save changed;
 *   empty or missing means "treat all as changed"
 * @returns {{ slides: Array<Object>, adoptedIds: Set<string> }} the merged
 *   slides, and the ids whose remote version was taken over
 */
export function mergeRemoteSlides(
  localSlides,
  remoteSlides,
  { lockedSlideId = null, modifiedIds = [] } = {},
) {
  const localById = new Map(
    (localSlides || []).filter((s) => s?.id).map((s) => [s.id, s]),
  );
  const modified = new Set(modifiedIds || []);
  const adoptAll = modified.size === 0;
  const adoptedIds = new Set();
  const slides = [];
  for (const remoteSlide of remoteSlides || []) {
    if (!remoteSlide?.id) continue;
    const local = localById.get(remoteSlide.id);
    const keepLocal =
      local &&
      (remoteSlide.id === lockedSlideId ||
        (!adoptAll && !modified.has(remoteSlide.id)));
    if (keepLocal) {
      slides.push(local);
    } else {
      slides.push(remoteSlide);
      adoptedIds.add(remoteSlide.id);
    }
  }
  return { slides, adoptedIds };
}

/**
 * @param {Object} deps
 * @param {Object} deps.api - API client
 * @param {string} deps.presentationId - Current presentation ID
 * @param {Object} deps.pres - Shared mutable presentation reference
 * @param {Object} deps.user - The current user ({ id }), for self-echo skip
 * @param {Function} deps.getSelectedSlideId - Returns currently selected slide ID
 * @param {Function} deps.getCurrentLockedSlideId - Returns slide ID locked by this user
 * @param {Function} deps.rerenderSlideList - Rerender the slide list panel
 * @param {Function} deps.rerenderEditor - Rerender the editor form
 * @param {Function} deps.rerenderPreview - Rerender the preview panel
 * @param {Object} deps.saveManager - Save manager (isDirty, isBlockedByConflict)
 * @returns {{ detach: Function }}
 */
export function createSlideUpdateHandler({
  api,
  presentationId,
  pres,
  user,
  getSelectedSlideId,
  getCurrentLockedSlideId,
  rerenderSlideList,
  rerenderEditor,
  rerenderPreview,
  saveManager,
}) {
  let debounceTimer = null;
  let pendingEvent = null;

  function handleEvent(e) {
    const { data } = e.detail || {};
    if (!data) return;

    // Self-ignore: skip events from our own saves, on the stable id the event
    // carries — the same rule the server enforces (shared/identity-match.js),
    // so a renamed editor still recognizes their own save.
    if (matchesIdentity(user, { userId: data.actorId })) return;

    // Revision check: skip stale events
    if (typeof data.revision === 'number' && data.revision <= pres.revision)
      return;

    // Store the latest event data (coalescing rapid saves)
    pendingEvent = data;

    // Debounce: wait 500ms to coalesce rapid saves into a single fetch
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processPendingEvent, 500);
  }

  async function processPendingEvent() {
    const eventData = pendingEvent;
    pendingEvent = null;
    debounceTimer = null;

    if (!eventData) return;

    // Skip if save manager is in conflict state
    if (saveManager.isBlockedByConflict?.()) return;

    try {
      // Fetch the full updated presentation from the server
      const langParam = pres.i18n?.active ? `?lang=${pres.i18n.active}` : '';
      const remote = await api(
        `/api/presentations/${presentationId}${langParam}`,
      );
      if (!remote || !Array.isArray(remote.slides)) return;

      const lockedSlideId = getCurrentLockedSlideId();
      const selectedSlideId = getSelectedSlideId();

      const merged = mergeRemoteSlides(pres.slides, remote.slides, {
        lockedSlideId,
        modifiedIds: eventData.modifiedSlideIds,
      });
      pres.slides = merged.slides;
      const selectedSlideWasModified = merged.adoptedIds.has(selectedSlideId);

      // Update presentation metadata
      pres.revision = remote.revision;
      pres.modified = remote.modified;
      pres.updatedBy = remote.updatedBy;

      // The adopted remote slides are our new merge base: rebase the
      // save-manager's fingerprints so a later edit of an adopted slide
      // isn't flagged as a false conflict (slides with pending local edits
      // keep their previous base).
      saveManager.rebaseServerTruth?.(remote.slides);

      // The refetched deck already names the last writer (D22), so the toast
      // reads their display name instead of the address the SSE event carries
      // for the self-ignore comparison above.
      const who = remote.updatedBy?.displayName || 'another user';
      toast.info(`Slides updated by ${who}`, { id: 'remote-update' });

      // Re-render UI
      try {
        rerenderSlideList();
      } catch {
        /* ignore */
      }
      try {
        rerenderPreview();
      } catch {
        /* ignore */
      }

      // Only rerender editor if the selected (but not locked) slide was modified
      if (selectedSlideWasModified && selectedSlideId !== lockedSlideId) {
        try {
          rerenderEditor();
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.warn('Slide update fetch failed:', err.message || err);
    }
  }

  window.addEventListener('sse:presentation-updated', handleEvent);

  return {
    detach() {
      window.removeEventListener('sse:presentation-updated', handleEvent);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingEvent = null;
    },
  };
}
