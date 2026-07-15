/**
 * Editor live-edits bootstrap (feature-flagged: features.collab +
 * features.collabLiveEdits).
 *
 * Wires the live-doc binder (client/lib/collab/live-doc-binder.js) into the
 * open editor: waits for the presence session's provider to sync, then makes
 * the shared Y.Doc the write target for every local mutation (the
 * controller's markDirty seam calls `localEdit`) and routes doc-driven
 * changes to the editor's targeted re-renders.
 *
 * Re-render rules for remote changes:
 * - preview: only when the selected slide changed; `rerenderPreview` itself
 *   already refuses to wipe the DOM during an inline edit.
 * - editor form: only when the selected slide changed, and never while the
 *   focus is inside the form (a rebuild would eat the caret) — deferred to
 *   the next focusout instead.
 * - slide list: full re-render on structural changes or changes to
 *   non-selected slides (their thumbs live there); selected-slide-only
 *   changes use the cheaper single-item update.
 * - notes textarea + topbar title are synced here because the regular
 *   re-render paths only refresh them on slide change.
 *
 * Like the presence module, this is only ever loaded via dynamic import, so
 * flag-off sessions never pay for it.
 */

import { Y } from '../../../vendor/collab.js';
import { createDeckYdocCodec } from '../../../../shared/collab/deck-ydoc.js';
import { createLiveDocBinder } from '../../../lib/collab/live-doc-binder.js';
import { toast } from '../../../lib/toast.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * @param {Object} opts
 * @param {Object} opts.session - the presence session (owns the provider/doc)
 * @param {Object} opts.pres - the editor's live presentation object
 * @param {Function} opts.normalizeLang
 * @param {boolean} [opts.hadEarlyEdits] - edits happened before this module loaded
 * @param {Function} opts.getSelectedSlideId
 * @param {Function} opts.setSelectedSlideId
 * @param {Function} opts.rerenderSlideList
 * @param {Function} opts.rerenderEditor
 * @param {Function} opts.rerenderPreview
 * @param {Function} opts.updateSelectedSlideListItem
 * @param {HTMLElement} [opts.editorMount] - form panel root (focus guard)
 * @param {HTMLTextAreaElement} [opts.previewNotesTa]
 * @param {Function} [opts.setSaveStatus] - topbar chip
 * @param {Function} [opts.onTitleChanged] - topbar title element updater
 * @param {Function} [opts.onUndoStateChanged] - topbar undo/redo buttons
 * @returns {Object} live-edits handle for the controller
 */
export function initEditorLiveEdits({
  session,
  pres,
  normalizeLang,
  hadEarlyEdits = false,
  getSelectedSlideId,
  setSelectedSlideId,
  rerenderSlideList,
  rerenderEditor,
  rerenderPreview,
  updateSelectedSlideListItem,
  editorMount,
  previewNotesTa,
  setSaveStatus,
  onTitleChanged,
  onUndoStateChanged,
} = {}) {
  const provider = session?._provider;
  const doc = provider?.document;
  if (!doc) throw new Error('initEditorLiveEdits: session with provider is required');

  let destroyed = false;
  let ready = false;
  let everEdited = hadEarlyEdits;
  let queuedLocal = hadEarlyEdits;
  let connected = true;

  const tryCall = (fn) => {
    try {
      fn?.();
    } catch {
      // rerender callbacks are best-effort
    }
  };

  // ── remote-change rendering (debounced; pres is already mutated) ─────────

  let renderTimer = null;
  let editorRerenderPending = false;
  const pendingRender = { slideIds: new Set(), structure: false, title: false, meta: false };

  const formHasFocus = () =>
    !!editorMount && !!document.activeElement && editorMount.contains(document.activeElement);

  const requestEditorRerender = () => {
    if (formHasFocus()) {
      // Rebuilding the form would eat the user's caret; wait for focusout.
      editorRerenderPending = true;
      return;
    }
    editorRerenderPending = false;
    tryCall(rerenderEditor);
  };

  const onFormFocusOut = () => {
    if (!editorRerenderPending) return;
    // Focus may just be moving between fields inside the form.
    setTimeout(() => {
      if (!destroyed && editorRerenderPending && !formHasFocus()) {
        editorRerenderPending = false;
        tryCall(rerenderEditor);
      }
    }, 0);
  };
  editorMount?.addEventListener('focusout', onFormFocusOut);

  const refreshNotesTa = () => {
    if (!previewNotesTa || document.activeElement === previewNotesTa) return;
    const slide = (pres.slides || []).find((s) => s?.id === getSelectedSlideId?.());
    if (slide) previewNotesTa.value = typeof slide.notes === 'string' ? slide.notes : '';
  };

  function flushRender() {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if (destroyed) return;
    const p = {
      slideIds: pendingRender.slideIds,
      structure: pendingRender.structure,
      title: pendingRender.title,
      meta: pendingRender.meta,
    };
    pendingRender.slideIds = new Set();
    pendingRender.structure = false;
    pendingRender.title = false;
    pendingRender.meta = false;

    const selectedId = getSelectedSlideId?.();
    const selectionGone =
      !!selectedId && !(pres.slides || []).some((s) => s?.id === selectedId);
    if (selectionGone) setSelectedSlideId?.(pres.slides?.[0]?.id || null);

    if (p.title) onTitleChanged?.(String(pres.title ?? ''));

    const touchesOthers = [...p.slideIds].some((id) => id !== selectedId);
    if (p.structure || selectionGone || touchesOthers) tryCall(rerenderSlideList);
    else if (p.slideIds.has(selectedId)) tryCall(updateSelectedSlideListItem);

    const selectedTouched = selectionGone || (!!selectedId && p.slideIds.has(selectedId));
    // Meta-only changes (e.g. a remote theme switch) still repaint the
    // preview — parity with the flag-off SSE path, which re-renders on
    // every remote update. rerenderPreview guards active inline edits.
    if (selectedTouched || p.meta) tryCall(rerenderPreview);
    if (selectedTouched) {
      requestEditorRerender();
      refreshNotesTa();
    }
  }

  function queueRemoteRender({ changedSlideIds, structureChanged, titleChanged, metaChanged }) {
    for (const id of changedSlideIds || []) pendingRender.slideIds.add(id);
    pendingRender.structure = pendingRender.structure || !!structureChanged;
    pendingRender.title = pendingRender.title || !!titleChanged;
    pendingRender.meta = pendingRender.meta || !!metaChanged;
    if (!renderTimer) renderTimer = setTimeout(flushRender, 120);
  }

  // ── binder ────────────────────────────────────────────────────────────────

  const codec = createDeckYdocCodec(Y);
  const binder = createLiveDocBinder({
    Y,
    doc,
    codec,
    pres,
    getActiveLang: () => normalizeLang?.(pres?.i18n?.active) || null,
    onRemoteApplied: queueRemoteRender,
    onUndoStateChanged: () => {
      try {
        onUndoStateChanged?.();
      } catch {
        // ignore
      }
    },
  });

  const updateStatus = () => {
    if (!everEdited || destroyed) return;
    // Changes stream into the shared doc (persisted server-side); when the
    // socket is down they wait in the local doc and sync on reconnect.
    try {
      setSaveStatus?.(connected ? 'saved' : 'unsaved');
    } catch {
      // ignore
    }
  };

  const offConnection = session.onConnectionChange?.((isConnected) => {
    connected = !!isConnected;
    updateStatus();
  });

  const start = () => {
    if (ready || destroyed) return;
    ready = true;
    binder.attach({ flushInitialLocalEdits: queuedLocal });
    queuedLocal = false;
    // Show the doc's state (fresh open: identical; otherwise: catch-up).
    tryCall(rerenderSlideList);
    tryCall(rerenderPreview);
    requestEditorRerender();
    refreshNotesTa();
    onTitleChanged?.(String(pres.title ?? ''));
    onUndoStateChanged?.();
  };

  // Attach once the server's state (bootstrapped in onLoadDocument) is in.
  const tryStart = () => {
    if (!ready && !destroyed && doc.getMap('meta').get('extra')) start();
  };
  const onDocUpdate = () => tryStart();
  provider.on('synced', tryStart);
  doc.on('update', onDocUpdate);
  tryStart();

  // ── controller-facing API ─────────────────────────────────────────────────

  return {
    /** The markDirty seam: push the local mutation into the doc. */
    localEdit() {
      if (destroyed) return;
      everEdited = true;
      if (!ready) {
        queuedLocal = true;
        return;
      }
      binder.syncLocal();
      updateStatus();
    },
    undo() {
      if (!ready) return false;
      const ok = binder.undo();
      if (ok) {
        toast?.info?.(t('editor.undo', 'Undo'));
        flushRender();
        updateStatus();
      }
      return ok;
    },
    redo() {
      if (!ready) return false;
      const ok = binder.redo();
      if (ok) {
        toast?.info?.(t('editor.redo', 'Redo'));
        flushRender();
        updateStatus();
      }
      return ok;
    },
    canUndo: () => ready && binder.canUndo(),
    canRedo: () => ready && binder.canRedo(),
    /**
     * Language switching reads from the live doc instead of the (up to one
     * debounce window stale) server JSON. Returns null before first sync —
     * the caller falls back to the server fetch.
     */
    projectLanguage(lang) {
      return ready ? binder.projectLanguage(lang) : null;
    },
    /** Push a server translate response's language version into the doc. */
    adoptLanguageVersion(lang, version) {
      if (!ready) return;
      binder.adoptLanguageVersion(lang, version);
      updateStatus();
    },
    isReady: () => ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = null;
      try {
        provider.off('synced', tryStart);
        doc.off('update', onDocUpdate);
      } catch {
        // ignore
      }
      offConnection?.();
      editorMount?.removeEventListener('focusout', onFormFocusOut);
      binder.destroy();
    },
  };
}
