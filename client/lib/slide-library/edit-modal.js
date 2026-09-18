/**
 * Slide Library Edit Modal
 *
 * Edits a library item with the full slide form (D171): the name, then the
 * single-slide editor - the same form, field renderers and image picker as the
 * deck editor, on the `library` surface, over a presentation that exists only
 * in memory. Nothing is written until Save, and Save is one PATCH of
 * `{ name, content }` against the revision the item was loaded at (D170); the
 * server keeps the other language versions in step.
 */

import { t } from '../ui-i18n.js';
import { toast } from '../dom/toast.js';
import { createInlineError } from '../dom/inline-error.js';
import { createModal } from '../dom/modal.js';
import { contentLang } from './search.js';
import { cleanStr } from '../../../shared/string-utils.js';
import { SLIDE_TYPES as LOCAL_SLIDE_TYPES } from '../../../shared/slide-schemas.js';
import { createSingleSlideEditor } from '../../views/editor/single-slide-editor.js';
import { loadSlideTypes } from '../../views/editor/bootstrap.js';
import { meWithMeta } from '../user/auth.js';
import { h } from '../dom.js';

/**
 * The sentence for a refused save. A 409 and a 403 are states of this form
 * with their own explanation; anything else carries the server's sentence.
 * @param {any} err
 * @returns {string}
 */
function saveErrorMessage(err) {
  if (err?.statusCode === 409) {
    return t(
      'slideLibrary.edit.conflict',
      'Someone else saved this slide after you opened it. Close the editor and open the slide again to see their version.',
    );
  }
  if (err?.statusCode === 403) {
    return t(
      'slideLibrary.edit.notAllowed',
      'Only its maker or an admin can edit this shared slide.',
    );
  }
  return String(err?.message || err || t('common.saveFailed', 'Save failed'));
}

/**
 * Open the edit modal for a slide library item.
 *
 * @param {object} opts
 * @param {object} opts.item - the library item (updated in place on save)
 * @param {'personal'|'organization'} opts.shelf
 * @param {Function} opts.api - API client
 * @param {object} opts.apiOps - createSlideLibraryApi() operations
 * @param {(saved: boolean) => void} [opts.onClose]
 * @param {Function} [opts.rerender] - repaint the library behind the modal
 * @returns {Promise<void>}
 */
export async function openEditModal({
  item,
  shelf,
  api,
  apiOps,
  onClose,
  rerender,
} = {}) {
  const slideType = cleanStr(item?.slideType);
  const [SLIDE_TYPES, { user, features }] = await Promise.all([
    loadSlideTypes({ api, LOCAL_SLIDE_TYPES }),
    meWithMeta(),
  ]);
  if (!SLIDE_TYPES[slideType]) {
    toast.error(
      t('slideLibrary.edit.unsupportedType', 'Cannot edit this slide type.'),
    );
    return;
  }

  let workingName = item.name || '';
  let saving = false;
  let editor = null;

  const modal = createModal({
    title: t('slideLibrary.edit.title', 'Edit slide'),
    modalClass: 'ps-modal ps-lib-edit-modal bulk-edit-modal',
    fill: true,
    // Cancel lives in the footer beside Save; the header keeps the icon X.
    closeButton: 'icon',
    // Cancel, Escape and the backdrop all ask first when there is something
    // to lose; nothing has been written, so closing is the whole of cancel.
    isDirty: () =>
      !saving &&
      (editor?.isDirty() || workingName.trim() !== (item.name || '').trim()),
    confirmMessage: t(
      'slideLibrary.edit.discardConfirm',
      'Your changes to this slide will be lost.',
    ),
    onClose: (result) => {
      editor?.detach();
      onClose?.(result?.saved === true);
    },
  });
  modal.header.classList.add('ps-modal-header');

  const nameInput = h('input', {
    class: 'form-input',
    type: 'text',
    id: 'lib-edit-name',
    placeholder: t('slideLibrary.edit.namePlaceholder', 'Slide name…'),
    maxlength: 120,
    value: workingName,
  });
  nameInput.addEventListener('input', () => {
    workingName = nameInput.value;
  });
  const nameField = h('div', { class: 'field ps-lib-edit-name' });
  nameField.append(
    h('label', {
      class: 'field-label',
      text: t('slideLibrary.edit.name', 'Name'),
      for: 'lib-edit-name',
    }),
    nameInput,
  );

  const undoBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.undo', 'Undo'),
    onclick: () => editor?.undo(),
  });
  const redoBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('editor.redo', 'Redo'),
    onclick: () => editor?.redo(),
  });
  const syncHistory = () => {
    undoBtn.disabled = !editor?.canUndo();
    redoBtn.disabled = !editor?.canRedo();
  };

  editor = await createSingleSlideEditor({
    slideType,
    content: item.content || {},
    // The modal edits `item.content` - the base version - so it works in the
    // item's own language, not the library's browsing language.
    lang: contentLang(item),
    themeId: cleanStr(item.themeId),
    api,
    user,
    features,
    SLIDE_TYPES,
    onChange: syncHistory,
  });
  syncHistory();

  // `status` carries progress only ("Saving…"). A refusal is not progress: it
  // is a state of this form, so it goes in the one element for that, beside
  // Save and staying until the next attempt
  // (docs/reference/feedback-surfaces.md).
  const status = h('div', { class: 'help modal-status', text: '' });
  const saveError = createInlineError({ callout: true });
  const saveBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: t('common.save', 'Save'),
  });
  const cancelBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.requestClose(),
  });

  saveBtn.addEventListener('click', async () => {
    saveError.clear();
    const name = String(workingName || '').trim();
    if (!name) {
      saveError.show(
        t('slideLibrary.edit.nameRequired', 'Please enter a name.'),
        { control: nameInput },
      );
      return;
    }
    if (saving) return;
    saving = true;
    saveBtn.disabled = true;
    status.textContent = t('common.saving', 'Saving…');

    const result = await apiOps.saveSlide(
      shelf,
      item,
      { name, content: editor.getContent() },
      { rerender },
    );

    if (result.ok) {
      toast.success(t('slideLibrary.edit.saved', 'Slide saved.'));
      if (result.item) Object.assign(item, result.item);
      modal.close({ saved: true });
      return;
    }
    status.textContent = '';
    saveError.show(saveErrorMessage(result.error));
    saving = false;
    saveBtn.disabled = false;
  });

  const history = h('div', { class: 'row' });
  history.append(undoBtn, redoBtn);
  const footer = h('div', { class: 'ps-modal-footer ps-lib-edit-footer' });
  footer.append(history, status, saveError.el, cancelBtn, saveBtn);

  modal.append(nameField, editor.el);
  modal.show(document.body);
  // The footer is pinned below the scrolling body, so it sits next to
  // `.modal-content` rather than inside it - and show() rebuilds the dialog,
  // so it goes on afterwards.
  modal.modal.append(footer);

  requestAnimationFrame(() => {
    try {
      nameInput.focus();
      nameInput.select();
    } catch {
      // ignore
    }
  });
}
