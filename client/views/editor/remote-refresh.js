/**
 * Remote refresh — keeps a waking editor tab from acting on stale state.
 *
 * A tab that slept (laptop lid, background throttling, offline) misses the
 * SSE remote-update stream and would otherwise autosave a days-old copy the
 * moment the user touches it. On every wake signal (tab visible, window
 * focus, network back) this module probes the lightweight
 * `GET /api/presentations/:id/revision` endpoint:
 *
 * - server ahead + nothing dirty locally → silently adopt the server state
 *   (slides, i18n buffers, revision) and rebase the save-manager's base
 *   fingerprints, so the tab never *shows* stale content;
 * - server ahead + local dirty edits → trigger a save right away, which runs
 *   the exact same slide-level merge / conflict flow a normal autosave would,
 *   but before the user types anything further into the stale copy.
 *
 * Disabled in collab live-edit mode (the shared doc already keeps tabs live).
 */

import { initPresentationI18n, normalizeSlideNotes } from './bootstrap.js';

// Wake signals arrive in bursts (visibilitychange + focus fire together);
// one probe per window is plenty.
const CHECK_MIN_INTERVAL_MS = 10 * 1000;

/**
 * @param {Object} deps
 * @param {Function} deps.api - API client
 * @param {string} deps.id - Presentation ID
 * @param {Object} deps.pres - Shared mutable presentation reference
 * @param {Object} deps.saveManager - Save manager (isDirty, requestSave, rebaseServerTruth, …)
 * @param {Function} [deps.isEnabled] - Return false to skip checks (e.g. collab live-edit mode)
 * @param {Function} [deps.onRefreshed] - Called after a silent adoption with { changedSlideIds }
 * @returns {{ check: Function }}
 */
export function createRemoteRefresh({
  api,
  id,
  pres,
  saveManager,
  isEnabled = () => true,
  onRefreshed,
} = {}) {
  let checking = false;
  let lastCheckAt = 0;

  const diffChangedSlideIds = (before, after) => {
    const byId = new Map(
      (before || []).filter((s) => s?.id).map((s) => [s.id, s])
    );
    const changed = [];
    for (const s of after || []) {
      if (!s?.id) continue;
      const prev = byId.get(s.id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(s)) changed.push(s.id);
    }
    return changed;
  };

  const check = async () => {
    if (!isEnabled()) return;
    if (checking) return;
    const now = Date.now();
    if (now - lastCheckAt < CHECK_MIN_INTERVAL_MS) return;
    lastCheckAt = now;
    // A conflict modal is already asking the user to reload; don't fight it.
    if (saveManager?.isBlockedByConflict?.()) return;

    checking = true;
    try {
      const info = await api(`/api/presentations/${id}/revision`);
      const serverRev = Number(info?.revision);
      const localRev = Number(pres?.revision) || 1;
      if (!Number.isFinite(serverRev) || serverRev <= localRev) return;

      // Local edits pending: save now. The If-Match carries our stale
      // revision, so the server's merge / conflict flow resolves the gap
      // before the user types any further.
      if (saveManager?.isDirty?.() || saveManager?.isSaving?.()) {
        await saveManager.requestSave();
        return;
      }

      // Nothing dirty: silently adopt the server state.
      const active = pres?.i18n?.active;
      const langParam =
        active === 'nl' || active === 'en-GB'
          ? `?lang=${encodeURIComponent(active)}`
          : '';
      const fresh = await api(`/api/presentations/${id}${langParam}`);
      if (!fresh || !Array.isArray(fresh.slides)) return;
      // The user may have started typing during the fetch — leave the local
      // copy alone; their next save merges through the normal flow.
      if (saveManager?.isDirty?.() || saveManager?.isSaving?.()) return;

      const changedSlideIds = diffChangedSlideIds(pres.slides, fresh.slides);
      pres.title = typeof fresh.title === 'string' ? fresh.title : pres.title;
      pres.slides = fresh.slides;
      if (fresh.i18n && typeof fresh.i18n === 'object') pres.i18n = fresh.i18n;
      if (typeof fresh.revision === 'number') pres.revision = fresh.revision;
      if (typeof fresh.modified === 'string') pres.modified = fresh.modified;
      if (typeof fresh.updatedBy === 'string') pres.updatedBy = fresh.updatedBy;
      if (typeof fresh.scope === 'string') pres.scope = fresh.scope;
      // Re-point the active-language buffers exactly like the initial load.
      initPresentationI18n({ pres, initialLang: active || null });
      normalizeSlideNotes(pres);
      saveManager?.rebaseServerTruth?.(pres.slides);
      onRefreshed?.({ changedSlideIds });
    } catch {
      // Best-effort: a failed probe leaves the save-time guards in charge.
    } finally {
      checking = false;
    }
  };

  return { check };
}
