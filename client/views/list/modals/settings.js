import { t } from '../../../lib/ui-i18n.js';
import { createSettingsPanel } from '../../settings/panel.js';

export async function openAppSettingsModal({
  h,
  root,
  nav,
  user,
  openOverlayClosers,
} = {}) {
  const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
  const modal = h('div', { class: 'modal ps-modal settings-modal' });
  const header = h('div', { class: 'ps-modal-header' });
  const title = h('h2', {
    text: t('settings.title', 'Settings'),
  });

  let panelApi = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    if (panelApi && typeof panelApi.canClose === 'function' && !panelApi.canClose())
      return;
    closed = true;
    try {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    } finally {
      openOverlayClosers?.delete?.(close);
    }
  };

  const closeBtn = h(
    'button',
    {
      class: 'btn btn-secondary btn-icon ps-modal-close',
      type: 'button',
      'aria-label': t('common.close', 'Close'),
      onclick: () => close(),
    },
    [
      h(
        'svg',
        {
          width: '16',
          height: '16',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '2',
        },
        [h('path', { d: 'M18 6L6 18M6 6l12 12' })]
      ),
    ]
  );
  header.append(title, closeBtn);

  const body = h('div', { class: 'ps-modal-body' });
  const mount = h('div', { class: 'settings-modal-mount' });
  body.append(mount);
  modal.append(header, body);
  backdrop.append(modal);

  // Intentionally do NOT close on backdrop click: it's too easy to lose edits by accident.
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  root.append(backdrop);
  openOverlayClosers?.add?.(close);
  document.addEventListener('keydown', onKey);

  panelApi = await createSettingsPanel({
    h,
    user,
    hideTitle: true,
    onDone: () => {
      close();
      // Re-render current route (important if UI locale changed).
      nav?.(location.pathname + (location.search || ''));
    },
  });
  mount.append(panelApi.el);
  try {
    panelApi.focusEl?.focus?.();
  } catch {
    // ignore
  }

  return { close };
}
