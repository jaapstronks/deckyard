import { t } from '../../lib/ui-i18n.js';

// Session idle timeout: create session-end snapshot after 5 minutes of no edits
const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export function createSaveManager({
  api,
  toast,
  pres,
  id,
  SLIDE_TYPES,
  normalizeLang,
  otherLang,
  onConflict,
  onRemoteMerge,
  onStatusChange,
  getSelectedSlideId,
} = {}) {
  let dirty = false;
  let saving = false;
  let lastError = '';
  let lastErrorToast = '';
  let everDirty = false;
  let dirtyToastShown = false;
  let autosaveTimer = null;
  let blockedByConflict = false;
  let sessionIdleTimer = null;
  let lastEditTime = 0;

  let editVersion = 0;
  let savedVersion = 0;
  let saveInFlight = null;
  let saveQueued = false;

  // Track which slides have been modified since last save, keyed by the
  // editVersion of their most recent edit. Used for slide-level merge in
  // concurrent editing; the version lets us clear only entries that were
  // actually included in a completed save (edits made while a save is in
  // flight must stay tracked for the next save).
  const modifiedSlideIds = new Map();

  const setLastError = (e) => {
    lastError = String(e?.message || e || '');
    updatePills();
  };

  /**
   * Derive the persistent save-status shown in the topbar chip.
   * @returns {'saving'|'error'|'unsaved'|'saved'|'idle'}
   */
  const getStatus = () => {
    if (saving) return 'saving';
    if (lastError) return 'error';
    if (dirty) return 'unsaved';
    // 'idle' before the first edit so a freshly-opened deck shows no chip.
    return everDirty ? 'saved' : 'idle';
  };

  const updatePills = () => {
    if (lastError && lastError !== lastErrorToast) {
      toast.error(lastError, { id: 'editor-error' });
      lastErrorToast = lastError;
    } else if (!lastError) {
      lastErrorToast = '';
    }
    try {
      onStatusChange?.(getStatus());
    } catch {
      // ignore listener errors
    }
  };

  const scheduleAutosave = () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      if (dirty) requestSave();
    }, 1500);
  };

  const translatableKeysForType = (type) => {
    const def = SLIDE_TYPES?.[type];
    const fields = Array.isArray(def?.fields) ? def.fields : [];
    return fields
      .filter(
        (f) => f && (f.type === 'string' || f.type === 'markdown')
      )
      .map((f) => String(f.key || '').trim())
      .filter(Boolean);
  };

  /**
   * Translatable per-item text keys for a type's 'items' fields:
   * Map<fieldKey, string[]>. Mirrors the server's itemsFieldsForSlideType.
   */
  const itemTextKeysForType = (type) => {
    const def = SLIDE_TYPES?.[type];
    const fields = Array.isArray(def?.fields) ? def.fields : [];
    const map = new Map();
    for (const f of fields) {
      if (!f || f.type !== 'items' || !Array.isArray(f.itemFields)) continue;
      const keys = f.itemFields
        .filter((x) => x && (x.type === 'string' || x.type === 'markdown'))
        .map((x) => String(x.key || '').trim())
        .filter(Boolean);
      if (keys.length) map.set(String(f.key || ''), keys);
    }
    return map;
  };

  const ensureLangVersion = (lang) => {
    const l = normalizeLang(lang);
    if (!l) return false;
    pres.i18n.versions =
      pres.i18n.versions && typeof pres.i18n.versions === 'object'
        ? pres.i18n.versions
        : {};
    if (!pres.i18n.versions[l]) {
      pres.i18n.versions[l] = { title: '', slides: [] };
    }
    pres.i18n.versions[l].title =
      typeof pres.i18n.versions[l].title === 'string'
        ? pres.i18n.versions[l].title
        : '';
    pres.i18n.versions[l].slides = Array.isArray(pres.i18n.versions[l].slides)
      ? pres.i18n.versions[l].slides
      : [];
    return true;
  };

  const syncOtherLanguageStructureForSave = () => {
    const from = normalizeLang(pres?.i18n?.active) || 'nl';
    const to = otherLang(from);
    ensureLangVersion(from);
    // Only keep structure in sync if the target language version exists.
    if (!pres?.i18n?.versions?.[to]) return;
    ensureLangVersion(to);

    // Keep current buffers stored in i18n.versions
    pres.i18n.versions[from].title =
      typeof pres.title === 'string' ? pres.title : '';
    pres.i18n.versions[from].slides = Array.isArray(pres.slides)
      ? pres.slides
      : [];

    const srcSlides = pres.i18n.versions[from].slides;
    const tgtSlidesExisting = pres.i18n.versions[to].slides;
    const tgtById = new Map(
      tgtSlidesExisting
        .filter(
          (s) =>
            s &&
            typeof s === 'object' &&
            typeof s.id === 'string'
        )
        .map((s) => [s.id, s])
    );

    const nextTgtSlides = srcSlides.map((srcSlide) => {
      const sid = String(srcSlide?.id || '');
      const existing = sid ? tgtById.get(sid) : null;
      const translatable = new Set(
        translatableKeysForType(srcSlide?.type)
      );
      const base =
        existing && typeof existing === 'object'
          ? structuredClone(existing)
          : {
              id: sid,
              type: srcSlide?.type,
              // IMPORTANT: do NOT copy translatable fields from the source language into the target language.
              // For new slides, we want structure-only, with translatable fields empty.
              content: {},
              notes: '',
            };

      base.type = srcSlide?.type;
      base.notes = typeof base.notes === 'string' ? base.notes : '';
      base.content =
        base.content && typeof base.content === 'object'
          ? base.content
          : {};

      // Copy non-translatable parts from source for consistent visuals.
      const srcContent =
        srcSlide?.content && typeof srcSlide.content === 'object'
          ? srcSlide.content
          : {};
      const itemTextKeys = itemTextKeysForType(srcSlide?.type);
      for (const [k, v] of Object.entries(srcContent)) {
        if (translatable.has(k)) continue;
        // 'items' arrays are structural (count/order/icons follow the source)
        // but their text subfields are per-language: keep the target's own
        // texts where present, blank them where absent. A wholesale copy here
        // used to overwrite translated item texts on every save - and made
        // fresh versions look "already translated" to fillMissing.
        const textKeys = itemTextKeys.get(k);
        if (textKeys && Array.isArray(v)) {
          const existingArr = Array.isArray(base.content[k])
            ? base.content[k]
            : [];
          base.content[k] = v.map((srcItem, i) => {
            const merged =
              srcItem && typeof srcItem === 'object'
                ? structuredClone(srcItem)
                : srcItem;
            if (!merged || typeof merged !== 'object') return merged;
            const ex =
              existingArr[i] && typeof existingArr[i] === 'object'
                ? existingArr[i]
                : null;
            for (const ik of textKeys) {
              const tv = ex?.[ik];
              if (typeof tv === 'string' && tv.trim()) merged[ik] = tv;
              else if (typeof merged[ik] === 'string') merged[ik] = '';
            }
            return merged;
          });
          continue;
        }
        base.content[k] = structuredClone(v);
      }

      return base;
    });

    pres.i18n.versions[to].slides = nextTgtSlides;
  };

  const applyServerMeta = (updated) => {
    // Only apply server-enforced metadata; never overwrite local edits with a stale response.
    if (!updated || typeof updated !== 'object') return;
    if (typeof updated.modified === 'string') pres.modified = updated.modified;
    if (typeof updated.created === 'string') pres.created = updated.created;
    if (typeof updated.id === 'string') pres.id = updated.id;
    if (typeof updated.theme === 'string') pres.theme = updated.theme;
    if (typeof updated.revision === 'number') pres.revision = updated.revision;
    else if (typeof updated.revision === 'string' && updated.revision.trim())
      pres.revision = Number(updated.revision) || pres.revision;
    if (typeof updated.updatedBy === 'string') pres.updatedBy = updated.updatedBy;
    if (typeof updated.scope === 'string') pres.scope = updated.scope;
  };

  /**
   * Adopt the server's slides after a slide-level merge.
   *
   * The server bumps the revision by exactly 1 per save; a response revision
   * more than 1 ahead of what we sent means another editor saved in between
   * and the server merged both changes. If we only adopted the revision
   * number (applyServerMeta) our local copy would keep the stale content for
   * the other editor's slides — and our next save would pass the If-Match
   * check and silently overwrite their work. So: take the merged slides as
   * the new local truth, keeping only slides re-edited since this save
   * started (still pending in modifiedSlideIds).
   *
   * @returns {string[]|null} IDs of locally replaced slides, or null if no merge happened.
   */
  const adoptMergedSlides = (updated, sentRevision) => {
    const respRev = Number(updated?.revision);
    if (!Number.isFinite(respRev) || respRev <= sentRevision + 1) return null;
    const merged = Array.isArray(updated?.slides) ? updated.slides : null;
    if (!merged) return null;

    const localSlides = Array.isArray(pres.slides) ? pres.slides : [];
    const localById = new Map(
      localSlides
        .filter((s) => s && typeof s.id === 'string' && s.id)
        .map((s) => [s.id, s])
    );
    // Slides with pending local edits keep their local version.
    const keepLocal = new Set(modifiedSlideIds.keys());

    const changedIds = [];
    const next = merged.map((s) => {
      const sid = s && typeof s.id === 'string' ? s.id : '';
      if (sid && keepLocal.has(sid) && localById.has(sid)) {
        return localById.get(sid);
      }
      if (sid) {
        const local = localById.get(sid);
        if (!local || JSON.stringify(local) !== JSON.stringify(s)) {
          changedIds.push(sid);
        }
      }
      return s;
    });
    // Preserve locally added slides the server doesn't know about yet.
    const nextIds = new Set(next.map((s) => s?.id));
    for (const s of localById.values()) {
      if (keepLocal.has(s.id) && !nextIds.has(s.id)) next.push(s);
    }

    pres.slides = next;
    return changedIds;
  };

  /**
   * Mark the presentation as dirty (needs saving).
   * @param {Object} [opts] - Options
   * @param {string} [opts.slideId] - ID of the slide that was modified (for merge tracking)
   */
  const markDirty = (opts = {}) => {
    const wasDirty = dirty;
    editVersion += 1;
    dirty = true;
    everDirty = true;
    lastEditTime = Date.now();

    // Track which slide was modified for slide-level merge
    const slideId = opts?.slideId || getSelectedSlideId?.();
    if (slideId) {
      modifiedSlideIds.set(slideId, editVersion);
    }

    if (!wasDirty && !dirtyToastShown) {
      toast.info(
        t('editor.save.autosaveEnabled', 'Changes are saved automatically…'),
        {
        id: 'save-status',
        durationMs: 60000,
        }
      );
      dirtyToastShown = true;
    }
    updatePills();
    // If we're blocked by a conflict, don't keep retrying. User must reload.
    if (!blockedByConflict) scheduleAutosave();

    // Reset session idle timer: will create session-end snapshot after 5 min idle
    resetSessionIdleTimer();
  };

  /**
   * Reset the session idle timer. Called on each edit.
   * After SESSION_IDLE_TIMEOUT_MS of no edits, triggers session-end snapshot.
   */
  const resetSessionIdleTimer = () => {
    if (sessionIdleTimer) clearTimeout(sessionIdleTimer);
    sessionIdleTimer = setTimeout(() => {
      triggerSessionEnd();
    }, SESSION_IDLE_TIMEOUT_MS);
  };

  /**
   * Trigger a session-end snapshot. Called after idle timeout or tab close.
   * Ensures save is complete, then notifies server to create session-end snapshot.
   */
  const triggerSessionEnd = async () => {
    // Clear the timer to prevent duplicate calls
    if (sessionIdleTimer) {
      clearTimeout(sessionIdleTimer);
      sessionIdleTimer = null;
    }

    // Wait for any pending save to complete
    if (saveInFlight) {
      try {
        await saveInFlight;
      } catch {
        // ignore save errors here
      }
    }

    // Trigger immediate save if still dirty
    if (dirty && !blockedByConflict) {
      await requestSave();
    }

    // Notify server to create session-end snapshot
    try {
      await api(`/api/presentations/${id}/session-end`, {
        method: 'POST',
      });
    } catch {
      // session-end snapshots are best-effort
    }
  };

  const requestSave = async () => {
    if (!dirty) return;
    if (blockedByConflict) return;
    if (saveInFlight) {
      saveQueued = true;
      return;
    }

    const dirtyBefore = dirty;
    const savingVersion = editVersion;
    saving = true;
    lastError = '';
    updatePills();
    toast.info(t('editor.save.saving', 'Saving changes…'), {
      id: 'save-status',
      durationMs: 60000,
    });

    // Capture modified slides for this save
    const modifiedForThisSave = Array.from(modifiedSlideIds.keys());

    saveInFlight = (async () => {
      // Ensure server knows which language buffer is currently in pres.title/slides.
      pres.i18n = pres.i18n && typeof pres.i18n === 'object' ? pres.i18n : {};
      pres.i18n.active =
        pres.i18n.active === 'nl' || pres.i18n.active === 'en-GB'
          ? pres.i18n.active
          : 'nl';
      // Single mode: keep dominant in sync for list previews/back-compat.
      pres.i18n.dominant = pres.i18n.active;

      // Ensure slide additions/moves exist in the other language too (structure only).
      try {
        syncOtherLanguageStructureForSave();
      } catch {
        // ignore (best-effort)
      }

      const payload = JSON.stringify(pres);
      const sentRevision = Number(pres?.revision) || 1;
      const headers = {
        'If-Match': String(sentRevision),
      };

      // Send modified slide IDs for slide-level merge (concurrent editing)
      if (modifiedForThisSave.length > 0) {
        headers['X-Modified-Slides'] = JSON.stringify(modifiedForThisSave);
      }

      const updated = await api(`/api/presentations/${id}`, {
        method: 'PUT',
        headers,
        body: payload,
      });
      applyServerMeta(updated);

      // Stop tracking slides whose edits were included in this save.
      // Slides edited again while the save was in flight keep their entry
      // (their newer editVersion is above what this save captured).
      for (const [sid, ver] of modifiedSlideIds) {
        if (ver <= savingVersion) modifiedSlideIds.delete(sid);
      }

      // If the server merged our save with another editor's (slide-level
      // merge), adopt the merged result so our local copy doesn't go stale
      // while our revision advances.
      const remoteChangedIds = adoptMergedSlides(updated, sentRevision);
      if (remoteChangedIds) {
        try {
          onRemoteMerge?.({ changedSlideIds: remoteChangedIds });
        } catch {
          // rerender callbacks are best-effort
        }
      }

      return updated;
    })();

    try {
      await saveInFlight;
      savedVersion = Math.max(savedVersion, savingVersion);
    } catch (e) {
      // Conflict: someone else saved a newer version. Stop autosave spam and ask user to reload.
      if (Number(e?.statusCode) === 409) {
        blockedByConflict = true;
        lastError = t(
          'editor.save.conflict',
          'Conflict: this presentation was changed elsewhere. Reload to continue.'
        );
        toast.error(lastError, { id: 'save-status', durationMs: 12000 });
        try {
          onConflict?.(e);
        } catch {
          // ignore
        }
      } else if (Number(e?.statusCode) === 423) {
        // Server-side slide-lock enforcement: a changed slide is locked
        // (author lock or another editor holds it). Not a hard block like a
        // revision conflict — the next edit reschedules autosave as usual.
        const name = e?.details?.holderName || e?.details?.holderEmail || '';
        lastError = name
          ? t('editor.save.slideLockedBy', 'Not saved: a slide you changed is being edited by {name}.', { name })
          : t('editor.save.slideLocked', 'Not saved: a slide you changed is locked by the author.');
        toast.error(lastError, { id: 'save-status', durationMs: 12000 });
      } else {
      lastError = String(e.message || e);
      toast.error(
        t('editor.save.failed', 'Save failed: {error}', { error: lastError }),
        {
        id: 'save-status',
        durationMs: 8000,
        }
      );
      }
    } finally {
      saveInFlight = null;
      saving = false;

      dirty = editVersion > savedVersion;
      updatePills();

      if (dirtyBefore && !dirty && !lastError) {
        toast.success(t('editor.save.saved', 'Saved'), {
          id: 'save-status',
          durationMs: 1600,
        });
        dirtyToastShown = false;
      }

      // Only retry immediately if edits happened WHILE we were saving.
      // If the save failed (e.g. validation error), do NOT loop forever.
      // The next user edit will schedule another autosave attempt.
      if (saveQueued) {
        saveQueued = false;
        if (!blockedByConflict) requestSave();
      }
    }
  };

  const cancelAutosave = () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (sessionIdleTimer) clearTimeout(sessionIdleTimer);
    sessionIdleTimer = null;
  };

  /**
   * Get a session-end beacon URL and payload for use in beforeunload.
   * Used by editor-lifecycle.js for reliable delivery on tab close.
   */
  const getSessionEndBeacon = () => {
    // Only send beacon if there were recent edits (within the session idle timeout)
    const recentEdit = lastEditTime && (Date.now() - lastEditTime < SESSION_IDLE_TIMEOUT_MS);
    if (!recentEdit && !dirty) return null;
    return {
      url: `/api/presentations/${id}/session-end`,
      body: JSON.stringify({ beacon: true }),
    };
  };

  return {
    markDirty,
    requestSave,
    updatePills,
    setLastError,
    cancelAutosave,
    triggerSessionEnd,
    getSessionEndBeacon,
    isDirty: () => dirty,
    isSaving: () => saving,
    getLastError: () => lastError,
    getStatus,
    isBlockedByConflict: () => blockedByConflict,
    /**
     * Check if there was a recent edit within the session idle timeout.
     * Used by editor-lifecycle.js to determine if session-end beacon should be sent.
     * @returns {boolean} True if an edit occurred within SESSION_IDLE_TIMEOUT_MS
     */
    hadRecentEdit: () => lastEditTime && (Date.now() - lastEditTime < SESSION_IDLE_TIMEOUT_MS),
  };
}
