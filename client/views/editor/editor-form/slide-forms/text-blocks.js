import { t } from '../../../../lib/ui-i18n.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/icons.js';
import { createCollapsedState } from '../../../../lib/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';

const MAX_ROWS = 3;
const MAX_BLOCKS = 6;

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
  fieldText,
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

  function commitStructure() {
    syncToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  }

  function commitValue() {
    syncToNumbered(slide);
    markDirty?.();
    scheduleUiRefresh?.();
  }

  // Move a row within rows[]
  function swapRows(fromIdx, toIdx) {
    const [moved] = rows.splice(fromIdx, 1);
    rows.splice(toIdx, 0, moved);
    commitStructure();
  }

  // Swap blocks within a row
  function swapBlocks(rowIdx, fromBlockIdx, toBlockIdx) {
    const blocks = rows[rowIdx].blocks;
    const [moved] = blocks.splice(fromBlockIdx, 1);
    blocks.splice(toBlockIdx, 0, moved);
    commitStructure();
  }

  // ---- Rows header: label + add button + counter + bulk collapse ----
  const rowControls = h('div', { class: 'stack' });
  rowControls.append(
    h('div', { class: 'field-label', text: t('editor.textBlocks.rows', 'Rows') })
  );
  const controlsRow = h('div', { class: 'row is-wrap' });
  controlsRow.append(
    h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('editor.textBlocks.addRow', '+ Add row'),
      disabled: rows.length >= MAX_ROWS,
      onclick: () => {
        if (rows.length >= MAX_ROWS) return;
        rows.push({
          title: '',
          // Alternate the default colour so stacked rows read as bands.
          color: rows.length % 2 === 0 ? 'yellow' : 'black',
          arrow: 'none',
          blocks: [
            { title: 'Block 1', body: '' },
            { title: 'Block 2', body: '' },
            { title: 'Block 3', body: '' },
          ],
        });
        commitStructure();
      },
    }),
    h('div', { class: 'pill', text: `${rows.length} / ${MAX_ROWS}` })
  );
  const bulkToggle = collapseAllToggle({
    state: rowsState,
    keys: rows.map((_, idx) => rowsState.getKey(slide.id, idx + 1)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) controlsRow.append(bulkToggle);
  rowControls.append(controlsRow);
  form.append(rowControls);

  // ---- Row drag state (row card-groups reorder among each other) ----
  const rowsContainer = h('div', { class: 'items-reorder-list text-blocks-rows-list' });
  let draggingRowIndex = null;
  let rowDropTargetIndex = null;

  const clearRowDropIndicators = () => {
    for (const el of rowsContainer.querySelectorAll(
      ':scope > .card-group.is-drop-before, :scope > .card-group.is-drop-after'
    )) {
      el.classList.remove('is-drop-before', 'is-drop-after');
    }
    rowDropTargetIndex = null;
  };

  // Helper to render one row section (0-based rowIdx)
  function renderRowSection(rowIdx) {
    const rowNum = rowIdx + 1;
    const row = rows[rowIdx];

    // Get collapsed state for this row
    const rowKey = rowsState.getKey(slide.id, rowNum);
    const isCollapsed = rowsState.isCollapsed(rowKey);

    const rowSection = h('div', { class: 'stack card-group' });
    if (isCollapsed) {
      rowSection.classList.add('is-collapsed');
    }

    // Row header: drag handle + collapse toggle + title + remove
    const rowHeader = h('div', { class: 'row spread card-group-header' });
    const headerLeft = h('div', { class: 'card-group-header-left' });

    // Row drag handle
    const rowDragHandle = h('button', {
      type: 'button',
      class: 'item-drag-handle',
      title: t('editor.textBlocks.dragRowToReorder', 'Drag to reorder rows'),
      draggable: 'true',
    });
    rowDragHandle.appendChild(dragHandleIcon());
    const rowIndexBadge = h('span', { class: 'item-index-badge' });
    rowIndexBadge.textContent = String(rowNum);
    rowDragHandle.appendChild(rowIndexBadge);

    rowDragHandle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', `row:${rowIdx}`);
      e.dataTransfer.effectAllowed = 'move';
      draggingRowIndex = rowIdx;
      rowSection.classList.add('is-dragging');
    });
    rowDragHandle.addEventListener('dragend', () => {
      draggingRowIndex = null;
      rowSection.classList.remove('is-dragging');
      clearRowDropIndicators();
    });
    headerLeft.append(rowDragHandle);

    // Collapse/expand toggle
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

    // Row label; the optional row heading doubles as the preview when set.
    const rowLabel = row.title
      ? row.title
      : t(`editor.textBlocks.row${rowNum}`, `Row ${rowNum}`);
    headerLeft.append(
      h('div', { class: 'card-group-title', text: rowLabel })
    );

    rowHeader.append(headerLeft);

    // Remove row (keep at least one)
    if (rows.length > 1) {
      rowHeader.append(
        h('button', {
          class: 'btn btn-secondary btn-icon card-remove-btn',
          type: 'button',
          text: '×',
          title: t('editor.textBlocks.deleteRow', 'Delete row {n}', { n: rowNum }),
          'aria-label': t('editor.textBlocks.deleteRow', 'Delete row {n}', { n: rowNum }),
          onclick: () => {
            rows.splice(rowIdx, 1);
            commitStructure();
          },
        })
      );
    }
    rowSection.append(rowHeader);

    // Row drag-over/drop handling (reorder whole rows)
    rowSection.addEventListener('dragover', (e) => {
      if (draggingRowIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggingRowIndex === rowIdx) {
        clearRowDropIndicators();
        return;
      }
      const rect = rowSection.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? 'before' : 'after';
      clearRowDropIndicators();
      rowSection.classList.add(`is-drop-${pos}`);
      rowDropTargetIndex = rowIdx;
    });
    rowSection.addEventListener('dragleave', (e) => {
      if (e.currentTarget?.contains?.(e.relatedTarget)) return;
      if (rowDropTargetIndex === rowIdx) clearRowDropIndicators();
    });
    rowSection.addEventListener('drop', (e) => {
      if (draggingRowIndex === null) return;
      e.preventDefault();
      const fromIdx = draggingRowIndex;
      draggingRowIndex = null;
      clearRowDropIndicators();
      if (fromIdx !== rowIdx) swapRows(fromIdx, rowIdx);
    });

    // Collapsible content container
    const rowContent = h('div', { class: 'row-collapsible-content' });
    if (isCollapsed) {
      rowContent.style.display = 'none';
    }

    // Row title field (rows 2+; the first row never renders a heading)
    if (rowIdx > 0) {
      const titleInput = fieldText(
        t('editor.textBlocks.rowTitle', 'Row heading (optional)'),
        row.title || '',
        (v) => {
          row.title = v;
          commitValue();
        }
      );
      rowContent.append(titleInput);
    }

    // Row controls: color + arrow (arrow renders between this row and the next)
    const controlsGrid = h('div', { class: 'row gap-md' });

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
      if (opt.value === (row.color || 'yellow')) option.selected = true;
      colorSelect.append(option);
    }
    colorSelect.addEventListener('change', () => {
      row.color = colorSelect.value;
      commitValue();
    });
    colorLabel.append(colorSelect);
    controlsGrid.append(colorLabel);

    // Arrow after this row (only meaningful when another row follows)
    if (rowIdx < rows.length - 1) {
      const arrowLabel = h('div', { class: 'stack flex-1' });
      arrowLabel.append(
        h('div', { class: 'field-label', text: t('editor.textBlocks.arrow', 'Arrow') })
      );
      const arrowSelect = h('select', { class: 'form-select' });
      const arrowOptions = [
        { value: 'none', label: t('editor.textBlocks.arrowNone', 'None') },
        { value: 'down', label: t('editor.textBlocks.arrowDown', 'Down ↓') },
        { value: 'up', label: t('editor.textBlocks.arrowUp', 'Up ↑') },
      ];
      for (const opt of arrowOptions) {
        const option = h('option', { value: opt.value, text: opt.label });
        if (opt.value === (row.arrow || 'none')) option.selected = true;
        arrowSelect.append(option);
      }
      arrowSelect.addEventListener('change', () => {
        row.arrow = arrowSelect.value;
        commitValue();
      });
      arrowLabel.append(arrowSelect);
      controlsGrid.append(arrowLabel);
    }

    rowContent.append(controlsGrid);

    // ---- Blocks within this row ----
    const blocksContainer = h('div', { class: 'items-reorder-list text-blocks-list' });

    // Block drag state (scoped per row; blocks reorder within their row)
    let draggingBlockIndex = null;
    let blockDropTargetIndex = null;

    const clearBlockDropIndicators = () => {
      for (const el of blocksContainer.querySelectorAll(
        '.card-group.is-drop-before, .card-group.is-drop-after'
      )) {
        el.classList.remove('is-drop-before', 'is-drop-after');
      }
      blockDropTargetIndex = null;
    };

    row.blocks.forEach((block, blockIdx) => {
      const blockNum = blockIdx + 1;
      const blockWrap = h('div', { class: 'stack card-group block-fields' });
      blockWrap.dataset.blockIndex = String(blockNum);

      // Block header with drag handle, inline title input and remove
      const blockHeader = h('div', { class: 'row gap-sm block-header' });

      const dragHandle = h('button', {
        type: 'button',
        class: 'item-drag-handle',
        title: t('editor.textBlocks.dragToReorder', 'Drag to reorder'),
        draggable: 'true',
      });
      dragHandle.appendChild(dragHandleIcon());
      const indexBadge = h('span', { class: 'item-index-badge' });
      indexBadge.textContent = String(blockNum);
      dragHandle.appendChild(indexBadge);

      dragHandle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', `block:${blockIdx}`);
        e.dataTransfer.effectAllowed = 'move';
        draggingBlockIndex = blockIdx;
        blockWrap.classList.add('is-dragging');
      });
      dragHandle.addEventListener('dragend', () => {
        draggingBlockIndex = null;
        blockWrap.classList.remove('is-dragging');
        clearBlockDropIndicators();
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
        block.title = titleInput.value;
        commitValue();
      });
      blockHeader.append(titleInput);

      // Remove block (keep at least one per row)
      if (row.blocks.length > 1) {
        blockHeader.append(
          h('button', {
            class: 'btn btn-secondary btn-icon card-remove-btn',
            type: 'button',
            text: '×',
            title: t('editor.textBlocks.deleteBlock', 'Delete block {n}', { n: blockNum }),
            'aria-label': t('editor.textBlocks.deleteBlock', 'Delete block {n}', { n: blockNum }),
            onclick: () => {
              row.blocks.splice(blockIdx, 1);
              commitStructure();
            },
          })
        );
      }
      blockWrap.append(blockHeader);

      // Description field
      const bodyWrap = h('div', { class: 'stack field-stack' });
      const bodyInput = h('textarea', {
        class: 'form-input form-textarea-sm',
        placeholder: t('editor.textBlocks.blockBodyPlaceholder', 'Description...'),
      });
      bodyInput.value = block.body || '';
      bodyInput.addEventListener('input', () => {
        block.body = bodyInput.value;
        commitValue();
      });
      bodyWrap.append(bodyInput);

      const fieldsStack = h('div', { class: 'stack gap-sm' });
      fieldsStack.append(bodyWrap);
      blockWrap.append(fieldsStack);

      // Block drag-over/drop handling
      blockWrap.addEventListener('dragover', (e) => {
        if (draggingBlockIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggingBlockIndex === blockIdx) {
          clearBlockDropIndicators();
          return;
        }
        const rect = blockWrap.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const pos = e.clientY < midY ? 'before' : 'after';
        clearBlockDropIndicators();
        blockWrap.classList.add(`is-drop-${pos}`);
        blockDropTargetIndex = blockIdx;
      });
      blockWrap.addEventListener('dragleave', (e) => {
        if (e.currentTarget?.contains?.(e.relatedTarget)) return;
        if (blockDropTargetIndex === blockIdx) clearBlockDropIndicators();
      });
      blockWrap.addEventListener('drop', (e) => {
        if (draggingBlockIndex === null) return;
        e.preventDefault();
        e.stopPropagation();
        const fromIdx = draggingBlockIndex;
        draggingBlockIndex = null;
        clearBlockDropIndicators();
        if (fromIdx !== blockIdx) swapBlocks(rowIdx, fromIdx, blockIdx);
      });

      blocksContainer.append(blockWrap);
    });

    rowContent.append(blocksContainer);

    // Add block (bottom of the row's block list)
    const addBlockRow = h('div', { class: 'row is-wrap' });
    addBlockRow.append(
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t('editor.textBlocks.addBlock', '+ Add block'),
        disabled: row.blocks.length >= MAX_BLOCKS,
        onclick: () => {
          if (row.blocks.length >= MAX_BLOCKS) return;
          row.blocks.push({ title: `Block ${row.blocks.length + 1}`, body: '' });
          commitStructure();
        },
      }),
      h('div', { class: 'pill', text: `${row.blocks.length} / ${MAX_BLOCKS}` })
    );
    rowContent.append(addBlockRow);

    rowSection.append(rowContent);
    rowsContainer.append(rowSection);
  }

  rows.forEach((_, idx) => renderRowSection(idx));
  form.append(rowsContainer);
}
