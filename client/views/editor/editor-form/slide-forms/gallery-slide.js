import { renderFocusGridField } from '../focus-picker.js';
import { t } from '../../../../lib/ui-i18n.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/icons.js';
import { createCollapsedState } from '../../../../lib/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';

const MIN_IMAGES = 2;
const MAX_IMAGES = 6;

// Collapsed state manager for gallery images
const galleryImagesState = createCollapsedState('image');

function ensureImagesArray(slide) {
  if (!slide?.content) slide.content = {};
  if (!Array.isArray(slide.content.images)) {
    slide.content.images = [];
  }
  return slide.content.images;
}

function removeImageAtIndex(slide, index) {
  const images = ensureImagesArray(slide);
  if (index < 0 || index >= images.length) return false;
  if (images.length <= MIN_IMAGES) return false;
  images.splice(index, 1);
  return true;
}

export function renderGallerySlideForm({
  h,
  form,
  slide,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  fieldText,
  fieldImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  // Render title and subheading side-by-side
  const titleField = fieldByKey?.get('title');
  const subheadingField = fieldByKey?.get('subheading');
  const bottomSubheadingField = fieldByKey?.get('bottomSubheading');

  if (titleField || subheadingField) {
    used.add('title');
    used.add('subheading');
    const titleEl = titleField ? renderField(titleField) : null;
    const subheadingEl = subheadingField ? renderField(subheadingField) : null;
    const titleRow = fieldGrid([titleEl, subheadingEl].filter(Boolean), 2);
    if (titleRow) {
      titleRow.classList.add('editor-title-row');
      form.append(titleRow);
    }
  }

  if (bottomSubheadingField) {
    used.add('bottomSubheading');
    form.append(renderField(bottomSubheadingField));
  }

  // Layout in collapsible settings (background colour moved to the unified
  // Background section, editor-form.js).
  const layoutField = fieldByKey?.get('layout');

  used.add('layout');

  const layoutDetails = h('details', { class: 'editor-advanced' });
  const layoutSummary = h('summary', {
    class: 'editor-advanced-summary',
    text: t('editor.slide.layoutSettings', 'Layout settings'),
  });
  const layoutBody = h('div', { class: 'editor-advanced-body' });
  layoutDetails.append(layoutSummary, layoutBody);

  if (layoutField) {
    const row = fieldGrid([renderField(layoutField)].filter(Boolean), 1);
    if (row) layoutBody.append(row);
  }

  form.append(layoutDetails);

  // Mark images field as used (we render it custom)
  used.add('images');

  const images = ensureImagesArray(slide);
  const count = images.length;

  // Helper function to swap images in the array
  function swapImages(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= images.length) return;
    if (toIndex < 0 || toIndex >= images.length) return;
    if (fromIndex === toIndex) return;

    // Swap the image objects
    const temp = images[fromIndex];
    images[fromIndex] = images[toIndex];
    images[toIndex] = temp;

    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  }

  // Add/remove controls
  const imageControls = h('div', { class: 'stack' });
  imageControls.append(h('div', { class: 'field-label', text: t('editor.slide.images', 'Images') }));
  const controlsRow = h('div', { class: 'row is-wrap' });

  const addImage = () => {
    if (count >= MAX_IMAGES) return;
    images.push({ src: '', caption: '', alt: '', focusX: 50, focusY: 50 });
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };

  controlsRow.append(
    h('button', {
      class: 'btn btn-secondary',
      text: t('editor.slide.addImage', '+ Add image'),
      disabled: count >= MAX_IMAGES,
      onclick: () => addImage(),
    }),
    h('div', { class: 'pill', text: `${count} / ${MAX_IMAGES}` })
  );
  const bulkToggle = collapseAllToggle({
    state: galleryImagesState,
    keys: Array.from({ length: count }, (_, idx) => galleryImagesState.getKey(slide.id, idx)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) controlsRow.append(bulkToggle);
  imageControls.append(controlsRow);
  form.append(imageControls);

  // Images container for drag and drop
  const imagesContainer = h('div', { class: 'items-reorder-list gallery-images-list' });

  // Drag state tracking
  let draggingImageIndex = null;
  let dropTargetIndex = null;

  const clearDropIndicators = () => {
    for (const el of imagesContainer.querySelectorAll('.card-group.is-drop-before, .card-group.is-drop-after')) {
      el.classList.remove('is-drop-before', 'is-drop-after');
    }
    dropTargetIndex = null;
  };

  // Render each image with focus picker
  for (let i = 0; i < count; i += 1) {
    const image = images[i] || {};

    // Get collapsed state for this image
    const imageKey = galleryImagesState.getKey(slide.id, i);
    const isCollapsed = galleryImagesState.isCollapsed(imageKey);

    const imageWrap = h('div', { class: 'stack card-group' });
    imageWrap.dataset.imageIndex = String(i);
    if (isCollapsed) {
      imageWrap.classList.add('is-collapsed');
    }

    // Image header with drag handle, collapse toggle, title, and remove button
    const imageHeader = h('div', { class: 'row spread card-group-header' });

    // Left side: drag handle + collapse toggle + title
    const headerLeft = h('div', { class: 'card-group-header-left' });

    // Drag handle
    const dragHandle = h('button', {
      type: 'button',
      class: 'item-drag-handle',
      title: t('editor.gallery.dragToReorder', 'Drag to reorder'),
      draggable: 'true',
    });
    dragHandle.appendChild(dragHandleIcon());

    // Drag events on the handle
    dragHandle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.effectAllowed = 'move';
      draggingImageIndex = i;
      imageWrap.classList.add('is-dragging');
    });

    dragHandle.addEventListener('dragend', () => {
      draggingImageIndex = null;
      imageWrap.classList.remove('is-dragging');
      clearDropIndicators();
    });

    headerLeft.append(dragHandle);

    // Collapse/expand toggle button
    const collapseBtn = h('button', {
      type: 'button',
      class: 'row-collapse-toggle',
      title: isCollapsed
        ? t('editor.gallery.expand', 'Expand')
        : t('editor.gallery.collapse', 'Collapse'),
    });
    collapseBtn.appendChild(chevronDownIcon());
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      galleryImagesState.toggle(imageKey);
      rerenderEditor?.();
    });
    headerLeft.append(collapseBtn);

    // Image title
    headerLeft.append(h('div', { class: 'card-group-title', text: `${t('editor.slide.image', 'Image')} ${i + 1}` }));

    imageHeader.append(headerLeft);

    // Remove button (right side)
    if (count > MIN_IMAGES) {
      imageHeader.append(
        h('button', {
          class: 'btn btn-secondary btn-icon card-remove-btn',
          type: 'button',
          text: '×',
          title: `${t('editor.slide.removeImage', 'Remove image')} ${i + 1}`,
          'aria-label': `${t('editor.slide.removeImage', 'Remove image')} ${i + 1}`,
          onclick: () => {
            const ok = removeImageAtIndex(slide, i);
            if (!ok) return;
            markDirty?.();
            rerenderEditor?.();
            scheduleUiRefresh?.();
          },
        })
      );
    }
    imageWrap.append(imageHeader);

    // Collapsible content container
    const imageContent = h('div', { class: 'block-collapsible-content' });
    if (isCollapsed) {
      imageContent.style.display = 'none';
    }

    // Image picker - use proxy slide pattern to work with fieldImage
    const proxySlide = {
      type: slide.type,
      id: slide.id,
      content: new Proxy(image, {
        get(target, prop) {
          return target[prop];
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        },
      }),
    };
    const imgField = fieldImage(
      proxySlide,
      { key: 'src', label: t('editor.slide.imageUrl', 'Image'), type: 'image', hideHelp: true },
      (url) => {
        images[i].src = url;
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      }
    );
    imageContent.append(imgField);

    // Focus grid picker (always show for gallery since images are always cropped/cover)
    const focusEl = renderFocusGridField({
      h,
      label: t('editor.slide.imageFocus', 'Image focus (crop)'),
      helpText: t('editor.slide.imageFocusHelp', 'Pick what should stay visible when the image is cropped.'),
      focusX: image.focusX,
      focusY: image.focusY,
      onChange: ({ focusX, focusY }) => {
        images[i].focusX = focusX;
        images[i].focusY = focusY;
        markDirty?.();
        scheduleUiRefresh?.();
      },
    });
    imageContent.append(focusEl);

    // Caption and alt text
    const captionField = fieldText(
      t('editor.slide.caption', 'Caption'),
      image.caption || '',
      (v) => {
        images[i].caption = v;
        markDirty?.();
        scheduleUiRefresh?.();
      }
    );
    const altField = fieldText(
      t('editor.slide.altText', 'Alt text'),
      image.alt || '',
      (v) => {
        images[i].alt = v;
        markDirty?.();
        scheduleUiRefresh?.();
      }
    );
    imageContent.append(fieldGrid([captionField, altField], 2));

    imageWrap.append(imageContent);

    // Drag over handling on the image wrapper (works in collapsed mode too)
    imageWrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggingImageIndex === null || draggingImageIndex === i) {
        clearDropIndicators();
        return;
      }

      const rect = imageWrap.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? 'before' : 'after';

      clearDropIndicators();
      imageWrap.classList.add(`is-drop-${pos}`);
      dropTargetIndex = i;
    });

    imageWrap.addEventListener('dragleave', (e) => {
      if (e.currentTarget?.contains?.(e.relatedTarget)) return;
      if (dropTargetIndex === i) clearDropIndicators();
    });

    imageWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIndex = draggingImageIndex;
      const toIndex = i;

      if (fromIndex !== null && fromIndex !== toIndex) {
        swapImages(fromIndex, toIndex);
      }

      draggingImageIndex = null;
      clearDropIndicators();
    });

    imagesContainer.append(imageWrap);
  }

  form.append(imagesContainer);
}