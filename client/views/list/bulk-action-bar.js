import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { toast } from '../../lib/toast.js';
import { confirmModal } from '../../lib/modal.js';

/**
 * Creates a selection state manager for bulk operations
 * @returns {Object} Selection state manager
 */
export function createSelectionState() {
  const selected = new Map(); // id -> presentation data
  const listeners = new Set();
  let active = false;

  const notify = () => {
    for (const listener of listeners) {
      try {
        listener(getState());
      } catch {
        // ignore
      }
    }
  };

  const getState = () => ({
    count: selected.size,
    ids: Array.from(selected.keys()),
    items: Array.from(selected.values()),
    isActive: active,
  });

  return {
    isActive: () => active,
    isSelected: (id) => selected.has(id),
    toggle: (id, presentation) => {
      if (selected.has(id)) {
        selected.delete(id);
      } else {
        selected.set(id, presentation);
      }
      // Auto-activate when first item is selected
      if (selected.size > 0 && !active) {
        active = true;
      }
      // Auto-deactivate when all items are deselected
      if (selected.size === 0 && active) {
        active = false;
      }
      notify();
    },
    select: (id, presentation) => {
      if (!selected.has(id)) {
        selected.set(id, presentation);
        if (!active) active = true;
        notify();
      }
    },
    deselect: (id) => {
      if (selected.has(id)) {
        selected.delete(id);
        if (selected.size === 0) active = false;
        notify();
      }
    },
    clear: () => {
      selected.clear();
      active = false;
      notify();
    },
    activate: () => {
      if (!active) {
        active = true;
        notify();
      }
    },
    getState,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Creates a bulk action bar for managing selected presentations
 * @param {Object} opts - Options
 * @param {Object} opts.selectionState - Selection state manager
 * @param {Function} opts.api - API client
 * @param {Function} opts.onBulkDelete - Callback after bulk delete
 * @param {Function} [opts.onBulkRestore] - Callback after bulk restore (for trash view)
 * @param {Function} [opts.isTrashView] - Function that returns whether trash view is active
 * @returns {Object} - { el, detach }
 */
export function createBulkActionBar({
  selectionState,
  api,
  onBulkDelete,
  onBulkRestore,
  isTrashView = () => false,
}) {
  const bar = h('div', { class: 'bulk-action-bar' });

  const countLabel = h('span', { class: 'bulk-action-count' });

  const cancelBtn = h('button', {
    class: 'btn btn-secondary bulk-action-cancel',
    type: 'button',
    text: t('list.bulk.cancel', 'Cancel'),
    onclick: () => {
      selectionState.clear();
    },
  });

  // Normal view: Move to trash button
  const normalDeleteBtn = h('button', {
    class: 'btn btn-danger bulk-action-delete',
    type: 'button',
    text: t('list.bulk.delete', 'Move to trash'),
    onclick: async () => {
      const state = selectionState.getState();
      if (state.count === 0) return;

      const confirmMsg = t(
        'list.bulk.deleteConfirm',
        'Move {count} presentation(s) to trash?',
        { count: state.count }
      );
      if (!(await confirmModal(h, document.body, {
        title: t('list.bulk.delete', 'Move to trash'),
        message: confirmMsg,
        confirmLabel: t('list.bulk.delete', 'Move to trash'),
        danger: true,
      }))) return;

      normalDeleteBtn.disabled = true;

      try {
        let successCount = 0;
        let failCount = 0;

        for (const id of state.ids) {
          try {
            await api(`/api/presentations/${id}`, { method: 'DELETE' });
            successCount++;
          } catch {
            failCount++;
          }
        }

        if (successCount > 0) {
          toast.success(
            t('list.bulk.delete.done', '{count} presentation(s) moved to trash.', { count: successCount }),
            { id: 'bulk-delete', durationMs: 2500 }
          );
        }
        if (failCount > 0) {
          toast.error(
            t('list.bulk.delete.failed', 'Failed to delete {count} presentation(s).', { count: failCount }),
            { id: 'bulk-delete-error', durationMs: 3000 }
          );
        }

        selectionState.clear();
        onBulkDelete?.();
      } finally {
        normalDeleteBtn.disabled = false;
      }
    },
  });

  // Trash view: Restore button
  const restoreBtn = h('button', {
    class: 'btn btn-primary bulk-action-restore',
    type: 'button',
    text: t('list.bulk.restore', 'Restore'),
    onclick: async () => {
      const state = selectionState.getState();
      if (state.count === 0) return;

      restoreBtn.disabled = true;
      trashDeleteBtn.disabled = true;

      try {
        let successCount = 0;
        let failCount = 0;

        for (const id of state.ids) {
          try {
            await api(`/api/presentations/${id}/restore`, { method: 'POST' });
            successCount++;
          } catch {
            failCount++;
          }
        }

        if (successCount > 0) {
          toast.success(
            t('list.bulk.restore.done', '{count} presentation(s) restored.', { count: successCount }),
            { id: 'bulk-restore', durationMs: 2500 }
          );
        }
        if (failCount > 0) {
          toast.error(
            t('list.bulk.restore.failed', 'Failed to restore {count} presentation(s).', { count: failCount }),
            { id: 'bulk-restore-error', durationMs: 3000 }
          );
        }

        selectionState.clear();
        onBulkRestore?.();
      } finally {
        restoreBtn.disabled = false;
        trashDeleteBtn.disabled = false;
      }
    },
  });

  // Trash view: Delete permanently button
  const trashDeleteBtn = h('button', {
    class: 'btn btn-danger bulk-action-delete',
    type: 'button',
    text: t('list.bulk.deletePermanently', 'Delete permanently'),
    onclick: async () => {
      const state = selectionState.getState();
      if (state.count === 0) return;

      const confirmMsg = t(
        'list.bulk.deletePermanentlyConfirm',
        'Permanently delete {count} presentation(s)? This cannot be undone.',
        { count: state.count }
      );
      if (!(await confirmModal(h, document.body, {
        title: t('list.bulk.deletePermanently', 'Delete permanently'),
        message: confirmMsg,
        confirmLabel: t('list.bulk.deletePermanently', 'Delete permanently'),
        danger: true,
      }))) return;

      trashDeleteBtn.disabled = true;
      restoreBtn.disabled = true;

      try {
        let successCount = 0;
        let failCount = 0;

        for (const id of state.ids) {
          try {
            await api(`/api/presentations/${id}/permanent`, { method: 'DELETE' });
            successCount++;
          } catch {
            failCount++;
          }
        }

        if (successCount > 0) {
          toast.success(
            t('list.bulk.deletePermanently.done', '{count} presentation(s) permanently deleted.', { count: successCount }),
            { id: 'bulk-permanent-delete', durationMs: 2500 }
          );
        }
        if (failCount > 0) {
          toast.error(
            t('list.bulk.deletePermanently.failed', 'Failed to delete {count} presentation(s).', { count: failCount }),
            { id: 'bulk-permanent-delete-error', durationMs: 3000 }
          );
        }

        selectionState.clear();
        onBulkDelete?.();
      } finally {
        trashDeleteBtn.disabled = false;
        restoreBtn.disabled = false;
      }
    },
  });

  // Normal view actions
  const normalActions = h('div', { class: 'bulk-action-actions bulk-action-normal' }, [
    cancelBtn.cloneNode(true),
    normalDeleteBtn,
  ]);
  normalActions.querySelector('.bulk-action-cancel').onclick = () => selectionState.clear();

  // Trash view actions
  const trashActions = h('div', { class: 'bulk-action-actions bulk-action-trash' }, [
    cancelBtn,
    restoreBtn,
    trashDeleteBtn,
  ]);

  bar.append(countLabel, normalActions, trashActions);

  // Update UI based on selection state and current view
  const update = (state) => {
    const inTrash = isTrashView();
    bar.classList.toggle('is-visible', state.isActive && state.count > 0);
    bar.classList.toggle('is-trash-view', inTrash);
    countLabel.textContent = t('list.bulk.selected', '{count} selected', { count: state.count });

    // Show/hide appropriate action set
    normalActions.style.display = inTrash ? 'none' : 'flex';
    trashActions.style.display = inTrash ? 'flex' : 'none';
  };

  // Subscribe to selection changes
  const unsubscribe = selectionState.subscribe(update);

  // Initial state
  update(selectionState.getState());

  return {
    el: bar,
    update: () => update(selectionState.getState()),
    detach: () => {
      unsubscribe();
    },
  };
}