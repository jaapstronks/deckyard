import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * How long a save runs before the status line says so. An autosave that lands
 * within this window stays quiet (the "Saved" toast follows); a slow one is a
 * state worth showing, where the save state lives (B645).
 */
export const SAVING_VISIBLE_AFTER_MS = 1500;

/**
 * The editor's save status line: background save failures stay visible until
 * storage or sync recovers, and a save that takes longer than
 * {@link SAVING_VISIBLE_AFTER_MS} shows as in progress.
 * @returns {{ el: HTMLElement, setStatus: Function, detach: Function }}
 */
export function createSaveStatus() {
  const message = h('span');
  const el = h(
    'div',
    {
      class: 'editor-save-status',
      role: 'status',
      'aria-live': 'polite',
      hidden: true,
    },
    [message],
  );
  let savingTimer = 0;

  const clearSavingTimer = () => {
    if (savingTimer) window.clearTimeout(savingTimer);
    savingTimer = 0;
  };

  const showSaving = () => {
    savingTimer = 0;
    el.classList.remove('is-failure');
    message.textContent = t('editor.save.saving', 'Saving changes…');
    el.hidden = false;
  };

  const setStatus = (status, detail = '', blocked = false) => {
    if (status === 'saving') {
      // A failure (or a slow save) already on screen stays; only a quiet
      // line starts the wait.
      if (el.hidden && !savingTimer) {
        savingTimer = window.setTimeout(showSaving, SAVING_VISIBLE_AFTER_MS);
      }
      return;
    }
    clearSavingTimer();
    const failed = status === 'error' || status === 'disconnected';
    el.classList.toggle('is-failure', failed);
    el.hidden = !failed;
    if (el.hidden) return;
    if (status === 'disconnected') {
      message.textContent = t(
        'editor.save.connectionLost',
        'Connection lost. Changes are waiting to sync; check your connection.',
      );
    } else if (blocked) {
      message.textContent =
        detail ||
        t(
          'editor.save.failedReload',
          'Changes were not saved. Reload the editor to continue.',
        );
    } else {
      message.textContent = `${detail || t('editor.save.failureState', 'Save failed.')} ${t('editor.save.retryHint', 'Edit again to retry saving.')}`;
    }
  };

  return { el, setStatus, detach: clearSavingTimer };
}
