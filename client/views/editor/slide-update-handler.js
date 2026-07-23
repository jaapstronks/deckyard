/**
 * Slide Update Handler
 * Listens for SSE `presentation:updated` events and merges remote changes
 * into the local editor state without disrupting editing or triggering autosave.
 */
import { toast } from '../../lib/dom/toast.js';

/**
 * @param {Object} deps
 * @param {Object} deps.api - API client
 * @param {string} deps.presentationId - Current presentation ID
 * @param {Object} deps.pres - Shared mutable presentation reference
 * @param {Function} deps.getSelectedSlideId - Returns currently selected slide ID
 * @param {Function} deps.getCurrentLockedSlideId - Returns slide ID locked by this user
 * @param {Function} deps.rerenderSlideList - Rerender the slide list panel
 * @param {Function} deps.rerenderEditor - Rerender the editor form
 * @param {Function} deps.rerenderPreview - Rerender the preview panel
 * @param {Object} deps.saveManager - Save manager (isDirty, isBlockedByConflict)
 * @returns {{ destroy: Function }}
 */
export function createSlideUpdateHandler({
  api,
  presentationId,
  pres,
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

    // Self-ignore: skip events from our own saves
    if (data.actorEmail && data.actorEmail === window.__currentUserEmail) return;

    // Revision check: skip stale events
    if (typeof data.revision === 'number' && data.revision <= pres.revision) return;

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
      const remote = await api(`/api/presentations/${presentationId}${langParam}`);
      if (!remote || !Array.isArray(remote.slides)) return;

      const lockedSlideId = getCurrentLockedSlideId();
      const selectedSlideId = getSelectedSlideId();
      const modifiedIds = new Set(eventData.modifiedSlideIds || []);
      let selectedSlideWasModified = false;

      // Merge remote slides into local state
      if (modifiedIds.size > 0) {
        for (const remoteSlide of remote.slides) {
          if (!remoteSlide?.id) continue;
          if (!modifiedIds.has(remoteSlide.id)) continue;

          // Never overwrite the slide the current user has locked
          if (remoteSlide.id === lockedSlideId) continue;

          const localIdx = pres.slides.findIndex((s) => s.id === remoteSlide.id);
          if (localIdx >= 0) {
            pres.slides[localIdx] = remoteSlide;
          }
          // New slides from remote are handled below via full array sync

          if (remoteSlide.id === selectedSlideId) {
            selectedSlideWasModified = true;
          }
        }

        // Handle new slides added remotely (not in local array)
        for (const remoteSlide of remote.slides) {
          if (!remoteSlide?.id) continue;
          const exists = pres.slides.some((s) => s.id === remoteSlide.id);
          if (!exists) {
            pres.slides.push(remoteSlide);
          }
        }

        // Handle slides removed remotely (in local but not in remote)
        const remoteIds = new Set(remote.slides.map((s) => s.id));
        pres.slides = pres.slides.filter((s) => remoteIds.has(s.id));
      } else {
        // No specific modified IDs — replace all slides except the locked one
        const mergedSlides = remote.slides.map((remoteSlide) => {
          if (remoteSlide.id === lockedSlideId) {
            const local = pres.slides.find((s) => s.id === lockedSlideId);
            return local || remoteSlide;
          }
          if (remoteSlide.id === selectedSlideId) {
            selectedSlideWasModified = true;
          }
          return remoteSlide;
        });
        pres.slides = mergedSlides;
      }

      // Update presentation metadata
      pres.revision = remote.revision;
      pres.modified = remote.modified;
      pres.updatedBy = remote.updatedBy;

      // The adopted remote slides are our new merge base: rebase the
      // save-manager's fingerprints so a later edit of an adopted slide
      // isn't flagged as a false conflict (slides with pending local edits
      // keep their previous base).
      saveManager.rebaseServerTruth?.(remote.slides);

      const who = eventData.actorEmail || 'another user';
      toast.info(`Slides updated by ${who}`, { id: 'remote-update' });

      // Re-render UI
      try { rerenderSlideList(); } catch { /* ignore */ }
      try { rerenderPreview(); } catch { /* ignore */ }

      // Only rerender editor if the selected (but not locked) slide was modified
      if (selectedSlideWasModified && selectedSlideId !== lockedSlideId) {
        try { rerenderEditor(); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn('Slide update fetch failed:', err.message || err);
    }
  }

  window.addEventListener('sse:presentation-updated', handleEvent);

  return {
    destroy() {
      window.removeEventListener('sse:presentation-updated', handleEvent);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingEvent = null;
    },
  };
}
