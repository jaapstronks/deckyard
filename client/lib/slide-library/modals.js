/**
 * Slide Library Modals
 * Lightbox and use-slide modal for the slide library picker
 */

import { t } from '../ui-i18n.js';
import { toast } from '../dom/toast.js';
import {
  RENDER_VIA_THEME,
  renderSlideElement,
} from '../slide-runtime/slide-render.js';
import { cleanStr } from '../../../shared/string-utils.js';
import { icon } from '../dom/icons.js';
import { createModal } from '../dom/modal.js';
import { createTagEditor } from '../../views/list/tag-editor.js';
import { getContentForLang } from './search.js';
import { openEditModal } from './edit-modal.js';
import { createInlineError } from '../dom/inline-error.js';
import { h } from '../dom.js';

/**
 * Create modal functions for the slide library
 * @param {object} options
 * @param {Function} options.api - API client
 * @param {object} options.state - State management object
 * @param {object} options.apiOps - API operations object
 * @param {Function} options.resolveThemeForItem - Theme resolver function
 * @param {Function} options.onSlideOpen - Callback when slide opens (for permalinks)
 * @param {Function} options.onSlideClose - Callback when slide closes (for permalinks)
 * @param {Function} options.onCopySlide - Callback for copy action (browse mode)
 * @param {Function} options.onNewPresentation - Callback for new presentation (browse mode)
 * @returns {object} Modal functions
 */
export function createSlideLibraryModals({
  api,
  state,
  apiOps,
  resolveThemeForItem,
  onSlideOpen = null,
  onSlideClose = null,
  onCopySlide = null,
  onNewPresentation = null,
}) {
  const makeSlideObj = (it, { lang = null } = {}) => ({
    id: 'lib-preview',
    type: cleanStr(it?.slideType),
    content: getContentForLang(it, lang || state.getLang()),
    notes: '',
  });

  const openLightbox = async (it, { rerender, updateUrl = true } = {}) => {
    const slide = makeSlideObj(it);
    const thTheme = await resolveThemeForItem(it);
    const shelf = state.getShelf();

    // Notify URL change for permalink support
    if (updateUrl && onSlideOpen) {
      onSlideOpen({ shelf, slideId: it.id });
    }

    const titleText =
      cleanStr(it?.name) || t('slideLibrary.preview.untitled', 'Untitled');
    const modal = createModal({
      title: titleText,
      modalClass: 'ps-modal ps-lib-lightbox-modal',
      fill: true,
      onClose: () => {
        window.removeEventListener('resize', updateScale);
        tagEditor.detach?.();
        // Notify URL change for permalink support
        if (updateUrl && onSlideClose) onSlideClose();
      },
    });
    modal.header.classList.add('ps-modal-header');
    modal.content.classList.add('ps-modal-body', 'ps-lib-lightbox-body');
    const close = () => modal.close();

    // Header actions (Edit + the standard close button, side by side)
    const headerActions = h('div', { class: 'ps-modal-header-actions' });

    const openEditor = (item, itemShelf) =>
      openEditModal({
        item,
        shelf: itemShelf,
        api,
        apiOps,
        rerender,
        onClose: (saved) => {
          // Reopen the lightbox on the saved item, so it shows what was saved.
          // A fresh duplicate lives on the other shelf: the library behind
          // the modal already shows it, and this lightbox is gone.
          if (!saved || itemShelf !== shelf) return;
          close();
          openLightbox(item, { rerender, updateUrl });
        },
      });

    // Edit reads the server's verdict (`canEdit`, D170). A slide you may not
    // change keeps the button, greyed out with the reason, and offers the way
    // that is open to you: a copy of your own.
    const canEdit = it?.canEdit === true;
    const notAllowed = t(
      'slideLibrary.edit.notAllowed',
      'Only its maker or an admin can edit this shared slide.',
    );
    const editBtn = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('common.edit', 'Edit'),
      title: canEdit
        ? t('slideLibrary.edit.tooltip', 'Edit slide content')
        : notAllowed,
      disabled: !canEdit,
      onclick: () => openEditor(it, shelf),
    });
    if (canEdit) {
      headerActions.append(editBtn);
    } else {
      const reason = h('span', {
        class: 'help ps-lib-edit-reason',
        id: `ps-lib-edit-reason-${cleanStr(it?.id)}`,
        text: notAllowed,
      });
      editBtn.setAttribute('aria-describedby', reason.id);
      const duplicateBtn = h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('slideLibrary.duplicate.action', 'Duplicate to my library'),
        title: t(
          'slideLibrary.duplicate.tooltip',
          'Make your own copy of this slide and edit that',
        ),
        onclick: async () => {
          duplicateError.clear();
          duplicateBtn.disabled = true;
          const result = await apiOps.duplicateToPersonal(it, { rerender });
          duplicateBtn.disabled = false;
          // A refused copy stays beside the button that asked for it.
          if (!result.ok) {
            duplicateError.show(
              String(result.error?.message || result.error || ''),
              { control: duplicateBtn },
            );
            return;
          }
          toast.success(
            t('slideLibrary.duplicate.done', 'Copied to your library.'),
          );
          close();
          openEditor(result.item, 'personal');
        },
      });
      const duplicateError = createInlineError({ callout: true });
      headerActions.append(reason, editBtn, duplicateBtn, duplicateError.el);
    }

    headerActions.append(modal.closeBtn);
    modal.header.append(headerActions);

    const stage = h('div', { class: 'ps-lib-lightbox-stage' });
    const bigThumb = h('div', { class: 'thumb ps-lib-lightbox-thumb' });

    const slideEl = renderSlideElement(slide, {
      theme: thTheme,
      renderVia: RENDER_VIA_THEME,
      lang: state.getLang?.(),
    });
    bigThumb.appendChild(slideEl);
    stage.append(bigThumb);

    // Metadata section (description + tags)
    const metaSection = h('div', { class: 'ps-lib-lightbox-meta' });

    // Description field
    const descLabel = h('label', {
      class: 'field-label',
      text: t('slideLibrary.description', 'Description'),
    });
    const descInput = h('textarea', {
      class: 'form-input',
      rows: 2,
      placeholder: t(
        'slideLibrary.descriptionPlaceholder',
        'Add a description…',
      ),
      value: it?.description || '',
      // The description is guarded like the content (D170); a slide you may
      // not change shows it without offering an edit the server refuses.
      readonly: !canEdit,
    });
    const descField = h('div', { class: 'field' });
    descField.append(descLabel, descInput);

    // Save description on blur
    descInput.addEventListener('blur', async () => {
      const newDesc = String(descInput.value || '').trim();
      if (newDesc === (it?.description || '')) return;
      const result = await apiOps.saveDescription(shelf, it, newDesc);
      if (!result.ok) {
        toast.error(
          t('slideLibrary.descriptionSaveError', 'Failed to save description'),
        );
      }
      rerender?.();
    });

    // Tags field
    const tagsLabel = h('label', {
      class: 'field-label',
      text: t('slideLibrary.tags', 'Tags'),
    });
    const initialTagNames = Array.isArray(it?.tags)
      ? it.tags.map((t) => t.name)
      : [];
    const tagEditor = createTagEditor({
      api,
      initialTags: initialTagNames,
      placeholder: t('slideLibrary.tagsPlaceholder', 'Add tags…'),
      // Tags follow the same rule as the description (D170, B340).
      readOnly: !canEdit,
      onChange: async (newTags) => {
        const result = await apiOps.saveTags(shelf, it, newTags);
        if (!result.ok) {
          toast.error(t('slideLibrary.tagsSaveError', 'Failed to save tags'));
        }
        rerender?.();
      },
    });
    const tagsField = h('div', { class: 'field' });
    tagsField.append(tagsLabel, tagEditor.el);

    metaSection.append(descField, tagsField);

    modal.append(stage, metaSection);
    modal.show(document.body);

    // Scale the slide to fit the viewport
    const updateScale = () => {
      const stageRect = stage.getBoundingClientRect();
      const maxW = stageRect.width;
      const maxH = stageRect.height;
      const slideW = 1600;
      const slideH = 900;
      const scale = Math.min(maxW / slideW, maxH / slideH, 1);
      bigThumb.style.setProperty('--thumb-scale', String(scale));
      bigThumb.style.width = `${slideW * scale}px`;
      bigThumb.style.height = `${slideH * scale}px`;
    };
    // Delay to allow layout
    requestAnimationFrame(() => requestAnimationFrame(updateScale));
    window.addEventListener('resize', updateScale);
  };

  const openUseSlideModal = (it) => {
    const modal = createModal({
      title: t('slideLibrary.useModal.title', 'Use slide'),
      hint: t('slideLibrary.useModal.hint', 'Choose how to use this slide.'),
    });

    // Prepare item with language-specific content
    const itemWithLangContent = {
      ...it,
      content: getContentForLang(it, state.getLang()),
      _selectedLang: state.getLang(),
    };

    // Create option buttons
    const optionsWrap = h('div', { class: 'ps-lib-use-options' });

    // Copy option
    const copyOption = h('button', {
      class: 'ps-lib-use-option',
      type: 'button',
      onclick: () => {
        modal.close();
        onCopySlide?.(itemWithLangContent);
      },
    });
    const copyIconEl = icon('copy', { size: 24 });
    copyOption.append(
      h('div', { class: 'ps-lib-use-option-icon' }, [copyIconEl]),
      h('div', { class: 'ps-lib-use-option-text' }, [
        h('div', {
          class: 'ps-lib-use-option-title',
          text: t('slideLibrary.useModal.copy', 'Copy to clipboard'),
        }),
        h('div', {
          class: 'ps-lib-use-option-desc',
          text: t(
            'slideLibrary.useModal.copy.desc',
            'Paste it into any presentation with Ctrl/Cmd+V',
          ),
        }),
      ]),
    );

    // New presentation option
    const newPresOption = h('button', {
      class: 'ps-lib-use-option',
      type: 'button',
      onclick: () => {
        modal.close();
        onNewPresentation?.(itemWithLangContent);
      },
    });
    newPresOption.append(
      h('div', { class: 'ps-lib-use-option-icon', text: '📄' }),
      h('div', { class: 'ps-lib-use-option-text' }, [
        h('div', {
          class: 'ps-lib-use-option-title',
          text: t('slideLibrary.useModal.newPresentation', 'New presentation'),
        }),
        h('div', {
          class: 'ps-lib-use-option-desc',
          text: t(
            'slideLibrary.useModal.newPresentation.desc',
            'Create a new presentation starting with this slide',
          ),
        }),
      ]),
    );

    optionsWrap.append(copyOption, newPresOption);

    // Cancel button only (no action button needed)
    const actionsWrap = h('div', { class: 'row is-end modal-actions' });
    const cancelBtn = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('common.cancel', 'Cancel'),
      onclick: () => modal.close(),
    });
    actionsWrap.append(cancelBtn);

    modal.content.append(optionsWrap, actionsWrap);
    modal.show(document.body);
  };

  return {
    makeSlideObj,
    openLightbox,
    openUseSlideModal,
  };
}
