import { icon } from '../../../lib/dom/icons.js';
import { t } from '../../../lib/ui-i18n.js';
import { createSlideLibraryPicker } from '../../../lib/slide-library/index.js';

export function openSlideLibraryModal({
  h,
  root,
  api,
  pres,
  SLIDE_TYPES,
  afterSlideId = null,
  insertFromLibraryItem,
  openOverlayClosers,
  initialShelf = 'organization',
  initialQuery = '',
  allowInsert = true,
} = {}) {
  const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
  const modal = h('div', { class: 'modal ps-modal slide-library-modal' });
  const header = h('div', { class: 'ps-modal-header' });
  const title = h('h2', {
    text: t('slideLibrary.modal.title', 'Slide library'),
  });
  const closeBtn = h(
    'button',
    {
      class: 'btn btn-secondary btn-icon ps-modal-close',
      type: 'button',
      'aria-label': t('common.close', 'Close'),
      onclick: () => close(),
    },
    [icon('x', { size: 16 })],
  );
  header.append(title, closeBtn);

  const body = h('div', { class: 'ps-modal-body' });
  const hint = h('div', {
    class: 'help',
    text: t(
      'slideLibrary.modal.help',
      'Your personal library is just for you. The team library is shared with everyone.',
    ),
  });

  const mount = h('div', { class: 'ps-slide-library-mount' });
  body.append(hint, mount);
  modal.append(header, body);
  backdrop.append(modal);

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    } finally {
      openOverlayClosers?.delete?.(close);
    }
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  root.append(backdrop);
  openOverlayClosers?.add?.(close);
  document.addEventListener('keydown', onKey);

  const picker = createSlideLibraryPicker({
    h,
    api,
    themeId: pres?.theme || '',
    SLIDE_TYPES,
    insertFromLibraryItem,
    allowInsert,
    initialShelf,
    initialQuery,
  });
  picker.renderSlideLibraryPicker(mount, {
    afterSlideId,
    onPicked: allowInsert ? () => close() : null,
  });

  return { close, setState: picker.setState };
}
