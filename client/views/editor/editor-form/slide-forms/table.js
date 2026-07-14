import { parseMarkdownTable } from '../../../../../shared/markdown.js';
import { MAX_COLS, MAX_ROWS } from '../../../../../shared/slide-types/types/table-slide.js';
import { t } from '../../../../lib/ui-i18n.js';
import { toast } from '../../../../lib/toast.js';
import { createModal, createTextArea } from '../../../../lib/modal.js';

function clampInt(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

function ensureTableContent(slide) {
  if (!slide.content || typeof slide.content !== 'object') slide.content = {};
  if (!Array.isArray(slide.content.rows)) slide.content.rows = [];
  const c = clampInt(slide.content.colCount || 4, 1, MAX_COLS);
  slide.content.colCount = String(c);
  if (slide.content.headerRow !== 'off') slide.content.headerRow = 'on';
}

function normalizeRows(slide, colCount) {
  const rows = Array.isArray(slide.content?.rows) ? slide.content.rows : [];
  const out = rows
    .filter((r) => r && typeof r === 'object')
    .slice(0, MAX_ROWS)
    .map((r) => {
      const row = {};
      for (let c = 1; c <= colCount; c += 1) {
        const k = `c${c}`;
        row[k] = typeof r?.[k] === 'string' ? r[k] : '';
      }
      return row;
    });
  slide.content.rows = out;
  return out;
}

function emptyRow(colCount) {
  const row = {};
  for (let c = 1; c <= colCount; c += 1) row[`c${c}`] = '';
  return row;
}

function colLabel(i) {
  // 1 -> A, 2 -> B, ... 26 -> Z, 27 -> AA (not needed with MAX_COLS=10, but cheap).
  let n = Math.max(1, Number(i) || 1);
  let s = '';
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function tableToMarkdown({ header, rows, colCount }) {
  const cols = Math.max(1, Math.min(MAX_COLS, Number(colCount) || 1));
  const h = Array.from({ length: cols }, (_v, idx) => header?.[idx] || '');
  const sep = Array.from({ length: cols }, () => '---');
  const body = (rows || []).map((r) =>
    Array.from({ length: cols }, (_v, idx) => r?.[idx] || '')
  );
  const line = (cells) => `| ${cells.map((c) => String(c || '').trim()).join(' | ')} |`;
  return [line(h), line(sep), ...body.map(line)].join('\n');
}

// ─── structure mutations ─────────────────────────────────────────────────────

function addRow(slide) {
  const cols = clampInt(slide.content.colCount || 1, 1, MAX_COLS);
  if ((slide.content.rows || []).length >= MAX_ROWS) return false;
  slide.content.rows.push(emptyRow(cols));
  return true;
}

function addColumn(slide) {
  const cols = clampInt(slide.content.colCount || 1, 1, MAX_COLS);
  if (cols >= MAX_COLS) return false;
  const next = cols + 1;
  slide.content.colCount = String(next);
  for (const r of slide.content.rows || []) {
    if (!r || typeof r !== 'object') continue;
    const k = `c${next}`;
    if (typeof r[k] !== 'string') r[k] = '';
  }
  return true;
}

function deleteRow(slide, rIdx) {
  if ((slide.content.rows || []).length <= 1) return false;
  slide.content.rows.splice(rIdx, 1);
  return true;
}

/**
 * Delete column `cIdx` (1-based) and shift the columns after it left, so
 * removing a middle column keeps the remaining content (the old "− Column"
 * button could only drop the last column).
 */
function deleteColumn(slide, cIdx) {
  const cols = clampInt(slide.content.colCount || 1, 1, MAX_COLS);
  if (cols <= 1) return false;
  for (const r of slide.content.rows || []) {
    if (!r || typeof r !== 'object') continue;
    for (let c = cIdx; c < cols; c += 1) {
      const next = r[`c${c + 1}`];
      r[`c${c}`] = typeof next === 'string' ? next : '';
    }
    delete r[`c${cols}`];
  }
  slide.content.colCount = String(cols - 1);
  return true;
}

// ─── grid ────────────────────────────────────────────────────────────────────

/**
 * Build the editable table grid, with contextual structure affordances:
 * per-column delete in the column heads, a trailing "+" gutter to add a
 * column, per-row delete (existing), and an "+ Row" bar below the last row.
 *
 * Shared between the compact sidebar rendering and the roomy "Edit table"
 * modal (`variant: 'roomy'`).
 *
 * @param {Object} deps
 * @param {'compact'|'roomy'} [deps.variant]
 * @param {Function} deps.onStructure - called after any row/column add/delete
 * @param {Function} [deps.onCellFocus] - receives (rIdx, cIdx) on focus, used
 *   by callers that rebuild the grid to restore focus
 * @param {{r: number, c: number}|null} [deps.focusCell] - cell to focus after build
 */
function buildTableGrid({
  h,
  slide,
  variant = 'compact',
  markDirty,
  scheduleUiRefresh,
  onStructure,
  focusCell = null,
} = {}) {
  const colCount = clampInt(slide.content.colCount || 4, 1, MAX_COLS);
  slide.content.colCount = String(colCount);
  const rows = normalizeRows(slide, colCount);
  if (rows.length === 0) rows.push(emptyRow(colCount));

  const table = h('table', {
    class: `table-editor-grid${variant === 'roomy' ? ' is-roomy' : ''}`,
    role: 'grid',
  });

  const thead = h('thead');
  const hr = h('tr');
  hr.append(h('th', { class: 'table-editor-corner', text: '' }));
  for (let c = 1; c <= colCount; c += 1) {
    const head = h('th', { class: 'table-editor-colhead' });
    head.append(
      h('span', {
        text: colLabel(c),
        title: t('editor.table.colTitle', 'Column {col}', { col: colLabel(c) }),
      })
    );
    if (colCount > 1) {
      head.append(
        h('button', {
          class: 'btn btn-danger is-compact-sm table-editor-colhead-delete',
          text: '×',
          title: t('editor.table.deleteCol', 'Delete column {col}', {
            col: colLabel(c),
          }),
          onclick: () => {
            if (deleteColumn(slide, c)) onStructure?.();
          },
        })
      );
    }
    hr.append(head);
  }
  // Trailing add-column gutter
  hr.append(
    h('th', { class: 'table-editor-corner table-editor-addcol-th' }, [
      h('button', {
        class: 'btn btn-secondary is-compact-sm',
        text: '+',
        title: t('editor.table.addCol', '+ Column'),
        disabled: colCount >= MAX_COLS,
        onclick: () => {
          if (addColumn(slide)) onStructure?.();
        },
      }),
    ])
  );
  thead.append(hr);
  table.append(thead);

  const tbody = h('tbody');
  const headerEnabled = String(slide.content.headerRow || 'on') !== 'off';
  const cellInputs = new Map(); // 'r:c' -> input

  for (let rIdx = 0; rIdx < rows.length; rIdx += 1) {
    const tr = h('tr', {
      class: headerEnabled && rIdx === 0 ? 'is-header-row' : '',
    });
    tr.append(
      h('th', {
        class: 'table-editor-rowhead',
        text:
          headerEnabled && rIdx === 0
            ? t('editor.table.headerRow', 'Header')
            : String(rIdx + 1),
        title:
          headerEnabled && rIdx === 0
            ? t(
                'editor.table.headerRowHelp',
                'Header row (rendered as <th>)'
              )
            : t('editor.table.rowTitle', 'Row {n}', { n: rIdx + 1 }),
      })
    );

    for (let c = 1; c <= colCount; c += 1) {
      const k = `c${c}`;
      const input = h('input', {
        class: 'form-input table-editor-cell',
        type: 'text',
        value: rows[rIdx]?.[k] || '',
        placeholder:
          headerEnabled && rIdx === 0
            ? t('editor.table.headerCell', 'Header {col}', { col: colLabel(c) })
            : '',
        oninput: (e) => {
          const v = e?.target?.value ?? '';
          slide.content.rows[rIdx][k] = String(v);
          markDirty?.();
          scheduleUiRefresh?.();
        },
      });
      cellInputs.set(`${rIdx}:${c}`, input);
      tr.append(h('td', { class: 'table-editor-td' }, [input]));
    }

    tr.append(
      h('td', { class: 'table-editor-actions-td' }, [
        h('button', {
          class: 'btn btn-danger is-compact-sm',
          text: '×',
          title: t('editor.table.deleteRow', 'Delete row {n}', { n: rIdx + 1 }),
          disabled: rows.length <= 1,
          onclick: () => {
            if (deleteRow(slide, rIdx)) onStructure?.();
          },
        }),
      ])
    );

    tbody.append(tr);
  }

  // "+ Row" bar below the last row (contextual, replaces the old top cluster)
  const addTr = h('tr', { class: 'table-editor-addrow-tr' });
  addTr.append(
    h('td', { colspan: String(colCount + 2), class: 'table-editor-addrow-td' }, [
      h('button', {
        class: 'btn btn-secondary is-compact-sm table-editor-addrow-btn',
        text: t('editor.table.addRow', '+ Row'),
        disabled: rows.length >= MAX_ROWS,
        onclick: () => {
          if (addRow(slide)) {
            onStructure?.({ focusCell: { r: rows.length, c: 1 } });
          }
        },
      }),
    ])
  );
  tbody.append(addTr);
  table.append(tbody);

  if (focusCell) {
    const input = cellInputs.get(`${focusCell.r}:${focusCell.c}`);
    if (input) {
      // Defer until the grid is attached to the DOM.
      setTimeout(() => input.focus(), 0);
    }
  }

  return table;
}

// ─── "Edit table" modal ──────────────────────────────────────────────────────

function openTableEditorModal({
  h,
  slide,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  const modal = createModal(h, {
    title: t('editor.table.edit', 'Edit table'),
    hint: t(
      'editor.table.editHint',
      'Changes apply to the slide immediately.'
    ),
    modalClass: 'table-editor-modal',
    // Sync the compact sidebar grid with whatever happened in the modal.
    onClose: () => rerenderEditor?.(),
  });

  const gridHost = h('div', { class: 'table-editor-modal-grid' });

  const rebuild = ({ focusCell = null } = {}) => {
    gridHost.innerHTML = '';
    gridHost.append(
      buildTableGrid({
        h,
        slide,
        variant: 'roomy',
        markDirty,
        scheduleUiRefresh,
        focusCell,
        onStructure: (opts) => {
          markDirty?.();
          scheduleUiRefresh?.();
          rebuild(opts || {});
        },
      })
    );
  };
  rebuild();

  modal.content.append(gridHost);
  modal.show(document.body);
}

// ─── form ────────────────────────────────────────────────────────────────────

export function renderTableSlideForm({
  h,
  form,
  slide,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  ensureTableContent(slide);

  add('title');
  add('caption');

  // Compact appearance row: header + background + table style together
  // (table style is an appearance setting like background; it used to render
  // detached at the very bottom of the panel).
  const headerField = fieldByKey.get('headerRow');
  const bgField = fieldByKey.get('background');
  const styleField = fieldByKey.get('tableStyle');
  const animateByCellField = fieldByKey.get('animateByCell');
  if (headerField || bgField || styleField) {
    used.add('headerRow');
    used.add('background');
    used.add('tableStyle');
    const hEl = headerField ? renderField(headerField) : null;
    const bgEl = bgField ? renderField(bgField) : null;
    const styleEl = styleField ? renderField(styleField) : null;
    const row = fieldGrid([hEl, bgEl, styleEl], 2);
    if (row) form.append(row);
  }

  // Animate by cell toggle (for step-by-step builds)
  if (animateByCellField) {
    used.add('animateByCell');
    const animateEl = renderField(animateByCellField);
    if (animateEl) form.append(animateEl);
  }

  // Custom table editor UI (rows + cols).
  used.add('rows');
  used.add('colCount');

  const colCount = clampInt(slide.content.colCount || 4, 1, MAX_COLS);
  const rows = normalizeRows(slide, colCount);

  const wrap = h('div', { class: 'stack table-editor' });

  const labelRow = h('div', { class: 'row is-between table-editor-labelrow' });
  labelRow.append(
    h('div', { class: 'field-label', text: t('editor.table.title', 'Table') }),
    h('button', {
      class: 'btn btn-secondary is-compact-sm',
      text: t('editor.table.edit', 'Edit table'),
      title: t(
        'editor.table.editTip',
        'Open a roomy table editor in a dialog'
      ),
      onclick: () =>
        openTableEditorModal({
          h,
          slide,
          markDirty,
          rerenderEditor,
          scheduleUiRefresh,
        }),
    })
  );
  wrap.append(labelRow);

  wrap.append(
    buildTableGrid({
      h,
      slide,
      variant: 'compact',
      markDirty,
      scheduleUiRefresh,
      onStructure: () => {
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      },
    })
  );

  wrap.append(
    h('div', {
      class: 'pill table-editor-count',
      text: t('editor.table.count', '{rows} rows · {cols} columns', {
        rows: Math.max(rows.length, 1),
        cols: colCount,
      }),
    })
  );

  // Import from markdown
  const importWrap = h('details', { class: 'table-editor-import' });
  importWrap.append(
    h('summary', { text: t('editor.table.importTitle', 'Import from Markdown table') })
  );
  const ta = h('textarea', { class: 'form-input form-textarea-md' });
  ta.placeholder =
    '| Col A | Col B |\n| --- | --- |\n| Val 1 | Val 2 |';

  const importActions = h('div', { class: 'row is-wrap' });
  importActions.append(
    h('button', {
      class: 'btn btn-secondary',
      text: t('editor.table.import', 'Import'),
      onclick: async () => {
        const parsed = parseMarkdownTable(ta.value || '');
        if (!parsed) {
          toast.error(t('editor.table.importNotFound', 'No Markdown table found.'));
          return;
        }
        const cols = clampInt(parsed.colCount, 1, MAX_COLS);
        slide.content.colCount = String(cols);
        slide.content.headerRow = 'on';

        const newRows = [];
        const header = Array.from({ length: cols }, (_v, idx) =>
          parsed.header?.[idx] == null ? '' : String(parsed.header[idx])
        );
        newRows.push(
          Object.fromEntries(
            header.map((v, idx) => [`c${idx + 1}`, v])
          )
        );
        for (const r of parsed.rows || []) {
          const cells = Array.from({ length: cols }, (_v, idx) =>
            r?.[idx] == null ? '' : String(r[idx])
          );
          newRows.push(
            Object.fromEntries(
              cells.map((v, idx) => [`c${idx + 1}`, v])
            )
          );
        }
        slide.content.rows = newRows.slice(0, MAX_ROWS);
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      },
    }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('editor.table.copyMarkdown', 'Copy as Markdown'),
      onclick: async () => {
        const cols = clampInt(slide.content.colCount || 1, 1, MAX_COLS);
        const headerOn = String(slide.content.headerRow || 'on') !== 'off';
        const rs = normalizeRows(slide, cols);
        const header = headerOn && rs.length ? rs[0] : emptyRow(cols);
        const body = headerOn ? rs.slice(1) : rs;
        const md = tableToMarkdown({
          header: Array.from({ length: cols }, (_v, idx) => header[`c${idx + 1}`] || ''),
          rows: body.map((row) =>
            Array.from({ length: cols }, (_v, idx) => row[`c${idx + 1}`] || '')
          ),
          colCount: cols,
        });
        try {
          await navigator.clipboard.writeText(md);
          toast.success(t('editor.table.copied', 'Markdown table copied to clipboard.'));
        } catch {
          // Clipboard blocked: show the markdown in a read-only modal to copy manually.
          const m = createModal(h, {
            title: t('editor.table.copyMarkdownTitle', 'Table markdown'),
          });
          const taOut = createTextArea(h, { value: md, minHeight: '240px' });
          taOut.textarea.readOnly = true;
          m.content.append(taOut.wrap);
          m.show(document.body);
        }
      },
    })
  );
  importWrap.append(
    ta,
    importActions,
    h('div', {
      class: 'help',
      text:
        t(
          'editor.table.tip',
          'Tip: paste directly from Sheets/Excel as a Markdown pipe-table, or use a table from a content slide.'
        ),
    })
  );
  wrap.append(importWrap);

  form.append(wrap);
}
