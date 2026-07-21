import { toast } from '../../lib/dom/toast.js';
import { t } from '../../lib/ui-i18n.js';

export function createPresenterControlToggle({
  h,
  api,
  getSessionId,
  setControlEnabled,
} = {}) {
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
        `/api/present-sessions/${sessionId}/control/${on ? 'enable' : 'disable'}`,
        { method: 'POST', body: '{}' }
      );
      setControlEnabled?.(on);
      label.classList.toggle('is-active', on);
    } catch (e) {
      input.checked = false;
      setControlEnabled?.(false);
      label.classList.remove('is-active');
      toast.error(String(e?.message || e));
    }
  });

  return { el: label };
}
