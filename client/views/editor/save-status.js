import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';

/** Keep background save failures visible until storage or sync recovers. */
export function createSaveStatus() {
  const message = h('span');
  const el = h(
    'div',
    {
      class: 'editor-save-failure',
      role: 'status',
      'aria-live': 'polite',
      hidden: true,
    },
    [message],
  );

  const setStatus = (status, detail = '', blocked = false) => {
    el.hidden = status !== 'error' && status !== 'disconnected';
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

  return { el, setStatus };
}
