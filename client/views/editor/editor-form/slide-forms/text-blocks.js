import { t } from '../../../../lib/ui-i18n.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/icons.js';
import { createCollapsedState } from '../../../../lib/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';

// Collapsed state manager for rows
const rowsState = createCollapsedState('row');

/**
 * Sync rows[] back to numbered fields for backward compatibility.
 * This ensures older code paths and the renderer can use either format.
 */
function syncToNumbered(slide) {
  const rows = slide.content.rows || [];

  // Row 1
  const r1 = rows[0];
  if (r1) {
    slide.content.row1Count = String(r1.blocks.length);
    slide.content.row1Color = r1.color;
    slide.content.arrow1 = r1.arrow;
    for (let i = 0; i < 6; i++) {
      const b = r1.blocks[i] || {};
      slide.content[`row1Block${i + 1}Title`] = b.title || '';
      slide.content[`row1Block${i + 1}Body`] = b.body || '';
    }
  }

  // Row 2
  slide.content.row2Enabled = rows.length > 1 ? 'yes' : 'no';
  const r2 = rows[1];
  if (r2) {
    slide.content.row2Count = String(r2.blocks.length);
    slide.content.row2Color = r2.color;
    slide.content.row2Title = r2.title;
    slide.content.arrow2 = r2.arrow;
    for (let i = 0; i < 6; i++) {
      const b = r2.blocks[i] || {};
      slide.content[`row2Block${i + 1}Title`] = b.title || '';
      slide.content[`row2Block${i + 1}Body`] = b.body || '';
    }
  }

  // Row 3
  slide.content.row3Enabled = rows.length > 2 ? 'yes' : 'no';
  const r3 = rows[2];
  if (r3) {
    slide.content.row3Count = String(r3.blocks.length);
    slide.content.row3Color = r3.color;
    slide.content.row3Title = r3.title;
    for (let i = 0; i < 6; i++) {
      const b = r3.blocks[i] || {};
      slide.content[`row3Block${i + 1}Title`] = b.title || '';
      slide.content[`row3Block${i + 1}Body`] = b.body || '';
    }
  }
}

export function renderTextBlocksForm({
  h,
  form,
  slide,
  add,
  used,
  fieldGrid,
  fieldText,
  fieldTextarea,
  fieldEnum,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  // Title and subheading
  add('title');
  add('subheading');
  add('bottomSubheading');

  // Mark all row-related fields as used (hide from generic renderer)
  used.add('rows');
  for (let row = 1; row <= 3; row++) {
    used.add(`row${row}Count`);
    used.add(`row${row}Color`);
    used.add(`row${row}Enabled`);
    used.add(`row${row}Title`);
    for (let block = 1; block <= 6; block++) {
      used.add(`row${row}Block${block}Title`);
      used.add(`row${row}Block${block}Body`);
    }
  }
  used.add('arrow1');
  used.add('arrow2');

  // Normalize: if no rows[] but numbered fields exist, build rows on the fly
  if (!Array.isArray(slide.content.rows) || slide.content.rows.length === 0) {
    const rows = [];

    // Row 1 always exists
    const r1Count = Math.max(1, Math.min(6, Number(slide.content.row1Count || 3)));
    const r1Blocks = [];
    for (let i = 1; i <= r1Count; i++) {
      r1Blocks.push({
        title: slide.content[`row1Block${i}Title`] || '',
        body: slide.content[`row1Block${i}Body`] || '',
      });
    }
    rows.push({
      title: '',
      color: slide.content.row1Color || 'yellow',
      arrow: slide.content.arrow1 || 'none',
      blocks: r1Blocks,
    });

    // Row 2 if enabled
    if (slide.content.row2Enabled === 'yes') {
      const r2Count = Math.max(1, Math.min(6, Number(slide.content.row2Count || 3)));
      const r2Blocks = [];
      for (let i = 1; i <= r2Count; i++) {
        r2Blocks.push({
          title: slide.content[`row2Block${i}Title`] || '',
          body: slide.content[`row2Block${i}Body`] || '',
        });
      }
      rows.push({
        title: slide.content.row2Title || '',
        color: slide.content.row2Color || 'black',
        arrow: slide.content.arrow2 || 'none',
        blocks: r2Blocks,
      });
    }

    // Row 3 if enabled
    if (slide.content.row3Enabled === 'yes') {
      const r3Count = Math.max(1, Math.min(6, Number(slide.content.row3Count || 3)));
      const r3Blocks = [];
      for (let i = 1; i <= r3Count; i++) {
        r3Blocks.push({
          title: slide.content[`row3Block${i}Title`] || '',
          body: slide.content[`row3Block${i}Body`] || '',
        });
      }
      rows.push({
        title: slide.content.row3Title || '',
        color: slide.content.row3Color || 'yellow',
        arrow: 'none',
        blocks: r3Blocks,
      });
    }

    slide.content.rows = rows;
  }

  const rows = slide.content.rows;

  // Swap blocks within a row
  function swapBlocks(rowIdx, fromBlockIdx, toBlockIdx) {
    const blocks = rows[rowIdx].blocks;
    // Convert 1-based indices to 0-based
    const from = fromBlockIdx - 1;
    const to = toBlockIdx - 1;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    syncToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  }

  // Helper to render a row section
  function renderRowSection(rowNum, isOptional = false) {
    const rowIdx = rowNum - 1;
    const row = rows[rowIdx];
    const isEnabled = rowNum === 1 || rows.length >= rowNum;
    const count = row ? row.blocks.length : 3;
    const color = row?.color || 'yellow';

    // Get collapsed state for this row
    const rowKey = rowsState.getKey(slide.id, rowNum);
    const isCollapsed = rowsState.isCollapsed(rowKey);

    const rowSection = h('div', { class: 'stack card-group' });
    if (isCollapsed) {
      rowSection.classList.add('is-collapsed');
    }

    // Row header with title, collapse toggle, and controls
    const rowHeader = h('div', { class: 'row spread card-group-header' });

    // Left side: collapse toggle + enable checkbox (optional) + title
    const headerLeft = h('div', { class: 'card-group-header-left' });

    // Collapse/expand toggle button (only when row is enabled)
    if (isEnabled) {
      const collapseBtn = h('button', {
        type: 'button',
        class: 'row-collapse-toggle',
        title: isCollapsed
          ? t('editor.textBlocks.expand', 'Expand')
          : t('editor.textBlocks.collapse', 'Collapse'),
      });
      collapseBtn.appendChild(chevronDownIcon());
      collapseBtn.addEventListener('click', (e) => {
        e.preventDefault();
        rowsState.toggle(rowKey);
        rerenderEditor?.();
      });
      headerLeft.append(collapseBtn);
    }

    if (isOptional) {
      // Enable/disable toggle for optional rows
      const enableLabel = h('label', { class: 'row gap-sm' });
      const enableCheckbox = h('input', {
        type: 'checkbox',
        checked: isEnabled,
        onchange: () => {
          if (enableCheckbox.checked) {
            // Add row
            rows.push({
              title: '',
              color: rows.length % 2 === 0 ? 'yellow' : 'black',
              arrow: 'none',
              blocks: [
                { title: 'Block 1', body: '' },
                { title: 'Block 2', body: '' },
                { title: 'Block 3', body: '' },
              ],
            });
          } else {
            // Remove last row
            rows.pop();
          }
          syncToNumbered(slide);
          markDirty?.();
          rerenderEditor?.();
          scheduleUiRefresh?.();
        },
      });
      enableLabel.append(
        enableCheckbox,
        h('span', {
          class: 'card-group-title',
          text: t(`editor.textBlocks.row${rowNum}`, `Row ${rowNum}`),
        })
      );
      headerLeft.append(enableLabel);
    } else {
      headerLeft.append(
        h('div', {
          class: 'card-group-title',
          text: t(`editor.textBlocks.row${rowNum}`, `Row ${rowNum}`),
        })
      );
    }

    rowHeader.append(headerLeft);
    rowSection.append(rowHeader);

    if (!isEnabled) {
      form.append(rowSection);
      return;
    }

    // Collapsible content container
    const rowContent = h('div', { class: 'row-collapsible-content' });
    if (isCollapsed) {
      rowContent.style.display = 'none';
    }

    // Row title field (only for rows 2 and 3)
    if (rowNum > 1 && row) {
      const titleInput = fieldText(
        t('editor.textBlocks.rowTitle', 'Row heading (optional)'),
        row.title || '',
        (v) => {
          row.title = v;
          syncToNumbered(slide);
          markDirty?.();
          scheduleUiRefresh?.();
        }
      );
      rowContent.append(titleInput);
    }

    // Row controls: count and color
    const controlsRow = h('div', { class: 'row gap-md' });

    // Block count selector
    const countLabel = h('div', { class: 'stack flex-1' });
    countLabel.append(
      h('div', { class: 'field-label', text: t('editor.textBlocks.blockCount', 'Blocks') })
    );
    const countSelect = h('select', { class: 'form-select' });
    for (let i = 1; i <= 6; i++) {
      const opt = h('option', { value: String(i), text: String(i) });
      if (i === count) opt.selected = true;
      countSelect.append(opt);
    }
    countSelect.addEventListener('change', () => {
      if (!row) return;
      const newCount = Number(countSelect.value);
      const currentCount = row.blocks.length;
      if (newCount > currentCount) {
        // Add blocks
        for (let i = currentCount; i < newCount; i++) {
          row.blocks.push({ title: `Block ${i + 1}`, body: '' });
        }
      } else if (newCount < currentCount) {
        // Remove blocks from end
        row.blocks.splice(newCount);
      }
      syncToNumbered(slide);
      markDirty?.();
      rerenderEditor?.();
      scheduleUiRefresh?.();
    });
    countLabel.append(countSelect);
    controlsRow.append(countLabel);

    // Color selector
    const colorLabel = h('div', { class: 'stack flex-1' });
    colorLabel.append(
      h('div', { class: 'field-label', text: t('editor.textBlocks.color', 'Color') })
    );
    const colorSelect = h('select', { class: 'form-select' });
    const colorOptions = [
      { value: 'yellow', label: t('editor.textBlocks.colorYellow', 'Yellow') },
      { value: 'black', label: t('editor.textBlocks.colorBlack', 'Black') },
    ];
    for (const opt of colorOptions) {
      const option = h('option', { value: opt.value, text: opt.label });
      if (opt.value === color) option.selected = true;
      colorSelect.append(option);
    }
    colorSelect.addEventListener('change', () => {
      if (!row) return;
      row.color = colorSelect.value;
      syncToNumbered(slide);
      markDirty?.();
      scheduleUiRefresh?.();
    });
    colorLabel.append(colorSelect);
    controlsRow.append(colorLabel);

    rowContent.append(controlsRow);

    // Block fields container (for drag and drop)
    const blocksContainer = h('div', { class: 'items-reorder-list text-blocks-list' });

    // Drag state tracking
    let draggingBlockIndex = null;
    let dropTargetIndex = null;

    const clearDropIndicators = () => {
      for (const el of blocksContainer.querySelectorAll('.card-group.is-drop-before, .card-group.is-drop-after')) {
        el.classList.remove('is-drop-before', 'is-drop-after');
      }
      dropTargetIndex = null;
    };

    // Block fields with drag and drop
    for (let i = 1; i <= count; i++) {
      const blockIdx = i - 1;
      const block = row?.blocks[blockIdx] || {};
      const blockWrap = h('div', { class: 'stack card-group block-fields' });
      blockWrap.dataset.blockIndex = String(i);

      // Block header with drag handle and inline title input
      const blockHeader = h('div', { class: 'row gap-sm block-header' });

      // Drag handle with subtle index badge
      const dragHandle = h('button', {
        type: 'button',
        class: 'item-drag-handle',
        title: t('editor.textBlocks.dragToReorder', 'Drag to reorder'),
        draggable: 'true',
      });
      dragHandle.appendChild(dragHandleIcon());
      const indexBadge = h('span', { class: 'item-index-badge' });
      indexBadge.textContent = String(i);
      dragHandle.appendChild(indexBadge);

      // Make the whole block draggable via the handle
      dragHandle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(i));
        e.dataTransfer.effectAllowed = 'move';
        draggingBlockIndex = i;
        blockWrap.classList.add('is-dragging');
      });

      dragHandle.addEventListener('dragend', () => {
        draggingBlockIndex = null;
        blockWrap.classList.remove('is-dragging');
        clearDropIndicators();
      });

      blockHeader.append(dragHandle);

      // Title input directly in the header row (primary identifier)
      const titleInput = h('input', {
        type: 'text',
        class: 'form-input item-inline-title',
        placeholder: t('editor.textBlocks.blockTitlePlaceholder', 'Block title...'),
        value: block.title || '',
      });
      titleInput.addEventListener('input', () => {
        if (row?.blocks[blockIdx]) {
          row.blocks[blockIdx].title = titleInput.value;
          syncToNumbered(slide);
          markDirty?.();
          scheduleUiRefresh?.();
        }
      });
      blockHeader.append(titleInput);
      blockWrap.append(blockHeader);

      // Description field
      const bodyWrap = h('div', { class: 'stack field-stack' });
      const bodyInput = h('textarea', {
        class: 'form-input form-textarea-sm',
        placeholder: t('editor.textBlocks.blockBodyPlaceholder', 'Description...'),
      });
      bodyInput.value = block.body || '';
      bodyInput.addEventListener('input', () => {
        if (row?.blocks[blockIdx]) {
          row.blocks[blockIdx].body = bodyInput.value;
          syncToNumbered(slide);
          markDirty?.();
          scheduleUiRefresh?.();
        }
      });
      bodyWrap.append(bodyInput);

      // Stack fields vertically
      const fieldsStack = h('div', { class: 'stack gap-sm' });
      fieldsStack.append(bodyWrap);
      blockWrap.append(fieldsStack);

      // Drag over handling
      blockWrap.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggingBlockIndex === null || draggingBlockIndex === i) {
          clearDropIndicators();
          return;
        }

        const rect = blockWrap.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const pos = e.clientY < midY ? 'before' : 'after';

        clearDropIndicators();
        blockWrap.classList.add(`is-drop-${pos}`);
        dropTargetIndex = i;
      });

      blockWrap.addEventListener('dragleave', (e) => {
        if (e.currentTarget?.contains?.(e.relatedTarget)) return;
        if (dropTargetIndex === i) clearDropIndicators();
      });

      blockWrap.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIndex = draggingBlockIndex;
        const toIndex = i;

        if (fromIndex && fromIndex !== toIndex) {
          swapBlocks(rowIdx, fromIndex, toIndex);
        }

        draggingBlockIndex = null;
        clearDropIndicators();
      });

      blocksContainer.append(blockWrap);
    }

    rowContent.append(blocksContainer);
    rowSection.append(rowContent);
    form.append(rowSection);
  }

  // Helper to render arrow selector
  function renderArrowSelector(afterRowNum) {
    const rowIdx = afterRowNum - 1;
    const row = rows[rowIdx];

    // Only show arrow selector if the next row exists
    if (!row || rows.length <= afterRowNum) return;

    const arrowValue = row.arrow || 'none';

    const arrowSection = h('div', { class: 'stack' });
    const arrowLabel = h('div', { class: 'field-label', text: t('editor.textBlocks.arrow', 'Arrow') });
    arrowSection.append(arrowLabel);

    const arrowSelect = h('select', { class: 'form-select' });
    const arrowOptions = [
      { value: 'none', label: t('editor.textBlocks.arrowNone', 'None') },
      { value: 'down', label: t('editor.textBlocks.arrowDown', 'Down ↓') },
      { value: 'up', label: t('editor.textBlocks.arrowUp', 'Up ↑') },
    ];
    for (const opt of arrowOptions) {
      const option = h('option', { value: opt.value, text: opt.label });
      if (opt.value === arrowValue) option.selected = true;
      arrowSelect.append(option);
    }
    arrowSelect.addEventListener('change', () => {
      row.arrow = arrowSelect.value;
      syncToNumbered(slide);
      markDirty?.();
      scheduleUiRefresh?.();
    });
    arrowSection.append(arrowSelect);

    form.append(arrowSection);
  }

  // Bulk collapse/expand for the row sections (only shows with 2+ rows)
  const bulkToggle = collapseAllToggle({
    state: rowsState,
    keys: Array.from({ length: rows.length }, (_, idx) => rowsState.getKey(slide.id, idx + 1)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) form.append(h('div', { class: 'row' }, [bulkToggle]));

  // Render Row 1 (always visible)
  renderRowSection(1, false);

  // Arrow 1 and Row 2
  renderArrowSelector(1);
  renderRowSection(2, true);

  // Arrow 2 and Row 3
  renderArrowSelector(2);
  renderRowSection(3, true);
}