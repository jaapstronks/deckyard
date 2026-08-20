import { toast } from '../../lib/dom/toast.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * The presenter's remote-control switch: flips the server-side gate that lets
 * the notes companion drive navigation.
 *
 * The toggle owns nothing beyond its own `checked` / `is-active` — the gate
 * itself lives on the server (`server/storage/live-sessions/control.js`),
 * and the presenter view has no state to keep in sync with it.
 *
 * @param {object} opts
 * @param {typeof import('../../lib/dom.js').h} opts.h
 * @param {Function} opts.api
 * @param {() => (string|null)} opts.getSessionId
 * @returns {{ el: HTMLElement }}
 */
export function createPresenterControlToggle({ h, api, getSessionId } = {}) {
  const label = h('label', { class: 'presenter-toggle' });
  const input = h('input', { type: 'checkbox', checked: false });
  const text = h('span', {
    text: t('presenter.control.short', 'RC'),
    title: t('presenter.control.title', 'Remote control'),
  });
  label.append(input, text);

  input.addEventListener('change', async () => {
    const sessionId = getSessionId?.() || null;
    if (!sessionId) {
      input.checked = false;
      return;
    }
    const on = !!input.checked;
    try {
      await api(
        `/api/live-sessions/${sessionId}/control/${on ? 'enable' : 'disable'}`,
        { method: 'POST', body: '{}' },
      );
      label.classList.toggle('is-active', on);
    } catch (e) {
      input.checked = false;
      label.classList.remove('is-active');
      toast.error(e);
    }
  });

  return { el: label };
}
