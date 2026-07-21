import { createModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';

export function openTitleModal({
  h,
  root,
  pres,
  setTitle,
  openOverlayClosers,
  newTitleKey,
  mode = 'edit',
} = {}) {
  const modal = createModal(h, {
    title:
      mode === 'new'
        ? t('editor.titleModal.newTitle', 'Name your presentation')
        : t('editor.titleModal.editTitle', 'Edit title'),
    hint:
      mode === 'new'
        ? t('editor.titleModal.newHint', 'This helps you find the presentation later.')
        : t('editor.titleModal.editHint', 'The title is saved automatically.'),
    onClose: () => {
      if (newTitleKey) {
        try {
          sessionStorage.removeItem(newTitleKey);
        } catch {
          // ignore
        }
      }
    },
  });

  const input = h('input', {
    class: 'form-input',
    value: pres.title,
    placeholder: t('editor.titleModal.placeholder', 'E.g. Annual plan 2026'),
    autocomplete: 'off',
    autofocus: true,
  });

  const status = h('div', {
    class: 'small modal-status',
    text: '',
  });

  const sync = () => {
    const v = String(input.value || '').trim();
    if (!v) {
      status.textContent = t('editor.titleModal.required', 'Please enter a title.');
      return;
    }
    status.textContent = '';
    setTitle(v);
  };

  input.addEventListener('input', sync);
  input.addEventListener('blur', () => {
    const v = String(input.value || '').trim();
    if (v) return;
    // Don't allow an empty title; restore the last saved title for clarity.
    input.value = pres.title || '';
    status.textContent = '';
  });

  modal.content.append(input, status);
  modal.show(root, openOverlayClosers);

  // Update status to reflect current content
  status.textContent = String(input.value || '').trim()
    ? ''
    : t('editor.titleModal.required', 'Please enter a title.');

  try {
    input.focus();
    input.select();
  } catch {
    // ignore
  }
}