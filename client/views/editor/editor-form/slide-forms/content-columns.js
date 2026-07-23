import { MAX_COLUMNS, MAX_TEXT_BLOCKS } from '../../../../../shared/slide-types/types/content-columns-slide.js';
import {
  ensureContentColumnsImages,
  resolveContentColumnImage,
  CONTENT_COLUMNS_IMAGE_DEFAULTS,
} from '../../../../../shared/slide-types/content-columns-images.js';
import { t } from '../../../../lib/ui-i18n.js';
import { renderFocusGridField } from '../focus-picker.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/dom/icons.js';
import { createCollapsedState } from '../../../../lib/slide-authoring/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';
import { createItemSwapper } from '../../../../lib/slide-authoring/item-swap.js';

// Collapsed state manager for columns
const columnsState = createCollapsedState('col');

export function renderContentColumnsForm({
  h,
  form,
  slide,
  add,
  used,
  fieldGrid,
  fieldText,
  fieldTextarea,
  fieldEnum,
  fieldImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  // Rendering the form also canonicalizes the content: stamped default-equal
  // image values (the old defaults wrote cover + focus 50/50 onto every
  // column) drop back to empty = follow the type (datamodel step 4).
  ensureContentColumnsImages(slide?.content);
  // Title and subheading
  add('title');
  add('subheading');
  add('bottomSubheading');

  // Mark all column fields as used (we'll render them ourselves)
  used.add('columnCount');
  for (let col = 1; col <= MAX_COLUMNS; col++) {
    used.add(`col${col}Title`);
    used.add(`col${col}Text`);
    used.add(`col${col}Image`);
    used.add(`col${col}ImageFit`);
    used.add(`col${col}ImageFocusX`);
    used.add(`col${col}ImageFocusY`);
    used.add(`col${col}Alt`);
    used.add(`col${col}BlockCount`);
    for (let block = 1; block <= MAX_TEXT_BLOCKS; block++) {
      used.add(`col${col}Block${block}Title`);
      used.add(`col${col}Block${block}Body`);
    }
  }

  // Column count selector
  const count = Math.max(1, Math.min(MAX_COLUMNS, Number(slide.content?.columnCount || 3)));

  // Build field list for column swapper
  const columnFields = ['Title', 'Text', 'Image', 'ImageFit', 'ImageFocusX', 'ImageFocusY', 'Alt', 'BlockCount'];
  for (let b = 1; b <= MAX_TEXT_BLOCKS; b++) {
    columnFields.push(`Block${b}Title`, `Block${b}Body`);
  }

  // Create swapper for column items
  const swapColumns = createItemSwapper({
    getSlide: () => slide,
    getPrefix: (colNum) => `col${colNum}`,
    fields: columnFields,
    callbacks: { markDirty, rerenderEditor, scheduleUiRefresh },
  });

  const columnCountSection = h('div', { class: 'stack' });
  const countLabel = h('div', { class: 'field-label', text: t('editor.contentColumns.columnCount', 'Number of columns') });
  const countHeader = h('div', { class: 'row spread' });
  countHeader.append(countLabel);
  const bulkToggle = collapseAllToggle({
    state: columnsState,
    keys: Array.from({ length: count }, (_, idx) => columnsState.getKey(slide.id, idx + 1)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) countHeader.append(bulkToggle);
  columnCountSection.append(countHeader);

  const countSelect = h('select', { class: 'form-select' });
  for (let i = 1; i <= MAX_COLUMNS; i++) {
    const opt = h('option', { value: String(i), text: String(i) });
    if (i === count) opt.selected = true;
    countSelect.append(opt);
  }
  countSelect.addEventListener('change', () => {
    slide.content.columnCount = countSelect.value;
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  });
  columnCountSection.append(countSelect);
  form.append(columnCountSection);

  // Columns container for drag and drop
  const columnsContainer = h('div', { class: 'items-reorder-list content-columns-list' });

  // Drag state tracking
  let draggingColIndex = null;
  let dropTargetIndex = null;

  const clearDropIndicators = () => {
    for (const el of columnsContainer.querySelectorAll('.card-group.is-drop-before, .card-group.is-drop-after')) {
      el.classList.remove('is-drop-before', 'is-drop-after');
    }
    dropTargetIndex = null;
  };

  // Render each column
  for (let colNum = 1; colNum <= count; colNum++) {
    renderColumnSection(colNum);
  }

  form.append(columnsContainer);

  function renderColumnSection(colNum) {
    const blockCount = Math.max(0, Math.min(MAX_TEXT_BLOCKS, Number(slide.content?.[`col${colNum}BlockCount`] || 1)));

    // Get collapsed state for this column
    const colKey = columnsState.getKey(slide.id, colNum);
    const isCollapsed = columnsState.isCollapsed(colKey);

    const colSection = h('div', { class: 'stack card-group' });
    colSection.dataset.colIndex = String(colNum);
    if (isCollapsed) {
      colSection.classList.add('is-collapsed');
    }

    // Column header with drag handle, collapse toggle, and title
    const colHeader = h('div', { class: 'row spread card-group-header' });

    // Left side: drag handle + collapse toggle + title
    const headerLeft = h('div', { class: 'card-group-header-left' });

    // Drag handle
    const dragHandle = h('button', {
      type: 'button',
      class: 'item-drag-handle',
      title: t('editor.contentColumns.dragToReorder', 'Drag to reorder'),
      draggable: 'true',
    });
    dragHandle.appendChild(dragHandleIcon());

    dragHandle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(colNum));
      e.dataTransfer.effectAllowed = 'move';
      draggingColIndex = colNum;
      colSection.classList.add('is-dragging');
    });

    dragHandle.addEventListener('dragend', () => {
      draggingColIndex = null;
      colSection.classList.remove('is-dragging');
      clearDropIndicators();
    });

    headerLeft.append(dragHandle);

    // Collapse/expand toggle
    const collapseBtn = h('button', {
      type: 'button',
      class: 'row-collapse-toggle',
      title: isCollapsed
        ? t('editor.contentColumns.expand', 'Expand')
        : t('editor.contentColumns.collapse', 'Collapse'),
    });
    collapseBtn.appendChild(chevronDownIcon());
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      columnsState.toggle(colKey);
      rerenderEditor?.();
    });
    headerLeft.append(collapseBtn);

    headerLeft.append(
      h('div', {
        class: 'card-group-title',
        text: t('editor.contentColumns.column', 'Column {n}', { n: colNum }),
      })
    );

    colHeader.append(headerLeft);
    colSection.append(colHeader);

    // Collapsible content
    const colContent = h('div', { class: 'block-collapsible-content' });
    if (isCollapsed) {
      colContent.style.display = 'none';
    }

    // Title block section
    const titleBlockLabel = h('div', { class: 'field-label', text: t('editor.contentColumns.titleBlock', 'Title block') });
    colContent.append(titleBlockLabel);

    // Title field
    const titleInput = h('input', {
      type: 'text',
      class: 'form-input',
      placeholder: t('editor.contentColumns.colTitle', 'Title (optional)'),
      value: slide.content?.[`col${colNum}Title`] || '',
    });
    titleInput.addEventListener('input', () => {
      slide.content[`col${colNum}Title`] = titleInput.value;
      markDirty?.();
      scheduleUiRefresh?.();
    });
    colContent.append(titleInput);

    // Text field
    const textInput = h('textarea', {
      class: 'form-input form-textarea-sm',
      placeholder: t('editor.contentColumns.colText', 'Text (optional, supports Markdown)'),
    });
    textInput.value = slide.content?.[`col${colNum}Text`] || '';
    textInput.addEventListener('input', () => {
      slide.content[`col${colNum}Text`] = textInput.value;
      markDirty?.();
      scheduleUiRefresh?.();
    });
    colContent.append(textInput);

    // Image section - compact layout without help text
    const imgField = fieldImage(
      slide,
      {
        key: `col${colNum}Image`,
        label: t('editor.contentColumns.image', 'Image (optional)'),
        type: 'image',
        hideHelp: true,
      },
      (url) => {
        slide.content[`col${colNum}Image`] = url;
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      }
    );
    colContent.append(imgField);

    // Only show image options if an image is set
    const hasImage = !!slide.content?.[`col${colNum}Image`];
    if (hasImage) {
      // Image fit and alt in a compact row
      const imageOptionsRow = h('div', { class: 'row gap-md is-wrap' });

      // Image fit selector - silent-default UX (step 4): the empty option
      // shows the derived type default plus its origin and doubles as
      // back-to-default by emptying the field (the default is looked up from
      // CONTENT_COLUMNS_IMAGE_DEFAULTS, never written into the column).
      const fitWrap = h('div', { class: 'stack' });
      fitWrap.append(
        h('div', { class: 'field-label', text: t('editor.contentColumns.imageFit', 'Image fit') })
      );
      const fitSelect = h('select', { class: 'form-select' });
      const typeFitLabel =
        CONTENT_COLUMNS_IMAGE_DEFAULTS.fit === 'contain'
          ? t('editor.contentColumns.fitContain', 'Fixed height')
          : t('editor.contentColumns.fitCover', 'Cropped (16:9)');
      const fitOptions = [
        {
          value: '',
          label: t('editor.imageText.fitDefaultType', 'Default · {fit}', { fit: typeFitLabel }),
        },
        { value: 'cover', label: t('editor.contentColumns.fitCover', 'Cropped (16:9)') },
        { value: 'contain', label: t('editor.contentColumns.fitContain', 'Fixed height') },
      ];
      const resolved = resolveContentColumnImage(slide.content, colNum);
      const currentFit = resolved.fitExplicit ? resolved.fit : '';
      for (const opt of fitOptions) {
        const option = h('option', { value: opt.value, text: opt.label });
        if (opt.value === currentFit) option.selected = true;
        fitSelect.append(option);
      }
      fitSelect.addEventListener('change', () => {
        slide.content[`col${colNum}ImageFit`] = fitSelect.value;
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      });
      fitWrap.append(fitSelect);
      imageOptionsRow.append(fitWrap);

      // Alt text
      const altWrap = h('div', { class: 'stack flex-1' });
      altWrap.append(
        h('div', { class: 'field-label', text: t('editor.contentColumns.altText', 'Alt text') })
      );
      const altInput = h('input', {
        type: 'text',
        class: 'form-input',
        placeholder: t('editor.contentColumns.altPlaceholder', 'Describe the image'),
        value: slide.content?.[`col${colNum}Alt`] || '',
      });
      altInput.addEventListener('input', () => {
        slide.content[`col${colNum}Alt`] = altInput.value;
        markDirty?.();
        scheduleUiRefresh?.();
      });
      altWrap.append(altInput);
      imageOptionsRow.append(altWrap);

      colContent.append(imageOptionsRow);

      // Focus picker - only show when the effective fit is 'cover' (cropped)
      if (resolved.fit === 'cover') {
        const focusEl = renderFocusGridField({
          h,
          label: t('editor.contentColumns.imageFocus', 'Image focus (crop)'),
          helpText: t('editor.contentColumns.imageFocusHelp', 'Pick what should stay visible when the image is cropped.'),
          focusX: resolved.focusX !== '' ? resolved.focusX : CONTENT_COLUMNS_IMAGE_DEFAULTS.focus.x,
          focusY: resolved.focusY !== '' ? resolved.focusY : CONTENT_COLUMNS_IMAGE_DEFAULTS.focus.y,
          onChange: ({ focusX, focusY }) => {
            slide.content[`col${colNum}ImageFocusX`] = focusX;
            slide.content[`col${colNum}ImageFocusY`] = focusY;
            markDirty?.();
            scheduleUiRefresh?.();
          },
        });
        colContent.append(focusEl);
      }
    }

    // Text blocks section
    const textBlocksLabel = h('div', { class: 'field-label', text: t('editor.contentColumns.textBlocks', 'Text blocks') });
    colContent.append(textBlocksLabel);

    // Text block count selector
    const blockCountRow = h('div', { class: 'row gap-md' });
    const blockCountLabel = h('div', { class: 'stack flex-1' });
    blockCountLabel.append(
      h('div', { class: 'field-label', text: t('editor.contentColumns.blockCount', 'Number of blocks') })
    );
    const blockCountSelect = h('select', { class: 'form-select' });
    for (let i = 0; i <= MAX_TEXT_BLOCKS; i++) {
      const opt = h('option', { value: String(i), text: String(i) });
      if (i === blockCount) opt.selected = true;
      blockCountSelect.append(opt);
    }
    blockCountSelect.addEventListener('change', () => {
      slide.content[`col${colNum}BlockCount`] = blockCountSelect.value;
      markDirty?.();
      rerenderEditor?.();
      scheduleUiRefresh?.();
    });
    blockCountLabel.append(blockCountSelect);
    blockCountRow.append(blockCountLabel);
    colContent.append(blockCountRow);

    // Render text blocks
    for (let i = 1; i <= blockCount; i++) {
      const blockWrap = h('div', { class: 'stack block-fields' });

      const blockHeader = h('div', {
        class: 'field-label',
        text: t('editor.contentColumns.blockN', 'Block {n}', { n: i }),
      });
      blockWrap.append(blockHeader);

      const titleKey = `col${colNum}Block${i}Title`;
      const bodyKey = `col${colNum}Block${i}Body`;

      const blockTitleInput = h('input', {
        type: 'text',
        class: 'form-input',
        placeholder: t('editor.contentColumns.blockTitle', 'Title (optional)'),
        value: slide.content?.[titleKey] || '',
      });
      blockTitleInput.addEventListener('input', () => {
        slide.content[titleKey] = blockTitleInput.value;
        markDirty?.();
        scheduleUiRefresh?.();
      });

      const blockBodyInput = h('textarea', {
        class: 'form-input form-textarea-sm',
        placeholder: t('editor.contentColumns.blockBody', 'Body text'),
      });
      blockBodyInput.value = slide.content?.[bodyKey] || '';
      blockBodyInput.addEventListener('input', () => {
        slide.content[bodyKey] = blockBodyInput.value;
        markDirty?.();
        scheduleUiRefresh?.();
      });

      const fieldRow = fieldGrid
        ? fieldGrid([
            h('div', { class: 'stack' }, [blockTitleInput]),
            h('div', { class: 'stack' }, [blockBodyInput]),
          ], 2)
        : h('div', { class: 'row gap-md' }, [
            h('div', { class: 'stack flex-1' }, [blockTitleInput]),
            h('div', { class: 'stack flex-1' }, [blockBodyInput]),
          ]);

      blockWrap.append(fieldRow);
      colContent.append(blockWrap);
    }

    colSection.append(colContent);

    // Drag over handling
    colSection.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggingColIndex === null || draggingColIndex === colNum) {
        clearDropIndicators();
        return;
      }

      const rect = colSection.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? 'before' : 'after';

      clearDropIndicators();
      colSection.classList.add(`is-drop-${pos}`);
      dropTargetIndex = colNum;
    });

    colSection.addEventListener('dragleave', (e) => {
      if (e.currentTarget?.contains?.(e.relatedTarget)) return;
      if (dropTargetIndex === colNum) clearDropIndicators();
    });

    colSection.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIndex = draggingColIndex;
      const toIndex = colNum;

      if (fromIndex && fromIndex !== toIndex) {
        swapColumns(fromIndex, toIndex);
      }

      draggingColIndex = null;
      clearDropIndicators();
    });

    columnsContainer.append(colSection);
  }
}