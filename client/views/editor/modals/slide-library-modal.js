import { createModal } from '../../../lib/dom/modal.js';
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
  const modal = createModal(h, {
    title: t('slideLibrary.modal.title', 'Slide library'),
    modalClass: 'ps-modal slide-library-modal',
    closeButton: 'icon',
  });
  modal.header.classList.add('ps-modal-header');
  modal.content.classList.add('ps-modal-body');

  const hint = h('div', {
    class: 'help',
    text: t(
      'slideLibrary.modal.help',
      'Your personal library is just for you. The team library is shared with everyone.',
    ),
  });

  const mount = h('div', { class: 'ps-slide-library-mount' });
  modal.append(hint, mount);
  modal.show(root, openOverlayClosers);

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
    onPicked: allowInsert ? () => modal.close() : null,
  });

  return { close: () => modal.close(), setState: picker.setState };
}
