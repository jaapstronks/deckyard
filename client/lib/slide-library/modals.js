/**
 * Slide Library Modals
 * Lightbox and use-slide modal for the slide library picker
 */

import { t } from '../ui-i18n.js';
import { toast } from '../dom/toast.js';
import { renderSlideElement } from '../slide-runtime/slide-render.js';
import { cleanStr } from '../../../shared/string-utils.js';
import { copyIcon } from '../dom/icons.js';
import { createModal } from '../dom/modal.js';
import { createTagEditor } from '../../views/list/tag-editor.js';
import { getContentForLang } from './search.js';
import { openEditModal } from './edit-modal.js';

/**
 * Create modal functions for the slide library
 * @param {object} options
 * @param {Function} options.h - DOM helper function
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
  h,
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
    const scope = state.getScope();

    // Notify URL change for permalink support
    if (updateUrl && onSlideOpen) {
      onSlideOpen({ scope, slideId: it.id });
    }

    const backdrop = h('div', { class: 'modal-backdrop ps-modal-overlay' });
    const modal = h('div', { class: 'modal ps-modal ps-lib-lightbox-modal' });

    const header = h('div', { class: 'ps-modal-header' });
    const titleText = cleanStr(it?.name) || t('slideLibrary.preview.untitled', 'Untitled');
    const title = h('h2', { text: titleText });

    // Header actions (Edit + Close)
    const headerActions = h('div', { class: 'ps-modal-header-actions' });

    // Edit button
    const editBtn = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('common.edit', 'Edit'),
      title: t('slideLibrary.edit.tooltip', 'Edit slide content'),
      onclick: () => {
        openEditModal({
          h,
          item: it,
          scope,
          apiOps,
          resolveThemeForItem,
          rerender,
          onClose: (saved) => {
            if (saved) {
              // Refresh the lightbox with updated content
              close();
              // Re-open with updated item
              openLightbox(it, { rerender, updateUrl });
            }
          },
        });
      },
    });

    const closeBtn = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    });

    headerActions.append(editBtn, closeBtn);
    header.append(title, headerActions);

    const body = h('div', { class: 'ps-modal-body ps-lib-lightbox-body' });
    const stage = h('div', { class: 'ps-lib-lightbox-stage' });
    const bigThumb = h('div', { class: 'thumb ps-lib-lightbox-thumb' });

    const slideEl = renderSlideElement(slide, { theme: thTheme });
    bigThumb.appendChild(slideEl);
    stage.append(bigThumb);

    // Metadata section (description + tags)
    const metaSection = h('div', { class: 'ps-lib-lightbox-meta' });

    // Description field
    const descLabel = h('label', { class: 'field-label', text: t('slideLibrary.description', 'Description') });
    const descInput = h('textarea', {
      class: 'form-input',
      rows: 2,
      placeholder: t('slideLibrary.descriptionPlaceholder', 'Add a description...'),
      value: it?.description || '',
    });
    const descField = h('div', { class: 'field' });
    descField.append(descLabel, descInput);

    // Save description on blur
    descInput.addEventListener('blur', async () => {
      const newDesc = String(descInput.value || '').trim();
      if (newDesc === (it?.description || '')) return;
      const result = await apiOps.saveDescription(scope, it, newDesc);
      if (!result.ok) {
        toast.error(t('slideLibrary.descriptionSaveError', 'Failed to save description'));
      }
      rerender?.();
    });

    // Tags field
    const tagsLabel = h('label', { class: 'field-label', text: t('slideLibrary.tags', 'Tags') });
    const initialTagNames = Array.isArray(it?.tags) ? it.tags.map((t) => t.name || t) : [];
    const tagEditor = createTagEditor({
      api,
      initialTags: initialTagNames,
      placeholder: t('slideLibrary.tagsPlaceholder', 'Add tags...'),
      onChange: async (newTags) => {
        const result = await apiOps.saveTags(scope, it, newTags);
        if (!result.ok) {
          toast.error(t('slideLibrary.tagsSaveError', 'Failed to save tags'));
        }
        rerender?.();
      },
    });
    const tagsField = h('div', { class: 'field' });
    tagsField.append(tagsLabel, tagEditor.el);

    metaSection.append(descField, tagsField);

    body.append(stage, metaSection);

    modal.append(header, body);
    backdrop.append(modal);
    document.body.append(backdrop);

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

    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    function close() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', updateScale);
      tagEditor.detach?.();
      backdrop.remove();
      // Notify URL change for permalink support
      if (updateUrl && onSlideClose) {
        onSlideClose();
      }
    }
  };

  const openUseSlideModal = (it) => {
    const modal = createModal(h, {
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
    const copyIconEl = copyIcon({ size: 24 });
    copyOption.append(
      h('div', { class: 'ps-lib-use-option-icon' }, [copyIconEl]),
      h('div', { class: 'ps-lib-use-option-text' }, [
        h('div', { class: 'ps-lib-use-option-title', text: t('slideLibrary.useModal.copy', 'Copy to clipboard') }),
        h('div', { class: 'ps-lib-use-option-desc', text: t('slideLibrary.useModal.copy.desc', 'Paste it into any presentation with Ctrl/Cmd+V') }),
      ])
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
        h('div', { class: 'ps-lib-use-option-title', text: t('slideLibrary.useModal.newPresentation', 'New presentation') }),
        h('div', { class: 'ps-lib-use-option-desc', text: t('slideLibrary.useModal.newPresentation.desc', 'Create a new presentation starting with this slide') }),
      ])
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