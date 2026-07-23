import { t } from '../../../lib/ui-i18n.js';
import { toast } from '../../../lib/dom/toast.js';

/**
 * Shared undo/redo actions for the editor. One implementation drives both the
 * keyboard shortcuts (Cmd+Z / Cmd+Shift+Z, in slide-list/keyboard-nav.js) and
 * the topbar buttons, so the restore logic lives in exactly one place.
 *
 * @param {object} deps
 * @param {object} deps.pres - The live presentation object (mutated in place)
 * @param {object} deps.undoManager - createUndoManager() instance
 * @param {Function} deps.getSelectedSlideId
 * @param {Function} deps.setSelectedSlideId
 * @param {Function} deps.markDirty
 * @param {object} deps.editorState - has dirtyRefreshAll()
 * @returns {{ performUndo: Function, performRedo: Function }}
 */
export function createUndoActions({
  pres,
  undoManager,
  getSelectedSlideId,
  setSelectedSlideId,
  markDirty,
  editorState,
} = {}) {
  /**
   * Apply a snapshot to restore presentation state.
   * Preserves server-managed fields (id, revision, modified, etc.).
   */
  const applySnapshot = (snapshot) => {
    if (!snapshot?.pres) return;

    // Preserve server-managed metadata
    const serverMeta = {
      id: pres.id,
      revision: pres.revision,
      modified: pres.modified,
      created: pres.created,
      updatedBy: pres.updatedBy,
      scope: pres.scope,
    };

    const restoredPres = snapshot.pres;

    // Replace arrays and objects
    pres.title = restoredPres.title;
    pres.slides = restoredPres.slides;
    pres.i18n = restoredPres.i18n;
    pres.theme = restoredPres.theme;

    // Restore any other top-level properties
    for (const key of Object.keys(restoredPres)) {
      if (!(key in serverMeta)) {
        pres[key] = restoredPres[key];
      }
    }

    // Re-apply server metadata
    Object.assign(pres, serverMeta);

    // Select a valid slide (the previously selected one if it still exists)
    const slideId = snapshot.slideId || getSelectedSlideId?.();
    const slideExists = pres.slides?.some((s) => s.id === slideId);
    if (slideExists) {
      setSelectedSlideId?.(slideId);
    } else if (pres.slides?.length > 0) {
      setSelectedSlideId?.(pres.slides[0].id);
    }

    // Mark dirty and refresh UI. Mark dirty EXACTLY ONCE: undo()/redo() set a
    // one-shot "skip capture" flag on the undo manager, so a second markDirty
    // here would push a spurious snapshot and wipe the redo stack. dirtyRefreshAll
    // already marks dirty, so don't also call markDirty separately.
    if (editorState?.dirtyRefreshAll) {
      editorState.dirtyRefreshAll();
    } else {
      markDirty?.();
    }
  };

  const performUndo = () => {
    if (!undoManager?.canUndo?.()) return false;
    const snapshot = undoManager.undo(pres);
    if (!snapshot?.pres) return false;
    applySnapshot(snapshot);
    toast?.info?.(t('editor.undo', 'Undo'));
    return true;
  };

  const performRedo = () => {
    if (!undoManager?.canRedo?.()) return false;
    const snapshot = undoManager.redo(pres);
    if (!snapshot?.pres) return false;
    applySnapshot(snapshot);
    toast?.info?.(t('editor.redo', 'Redo'));
    return true;
  };

  return { performUndo, performRedo };
}
