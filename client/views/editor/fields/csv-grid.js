/**
 * Chart data grid editor (option C: spreadsheet-style grid + a raw-CSV toggle).
 *
 * Replaces the generic prose/markdown toolbar that used to wrap the chart
 * `data` field. The chart data is a small `Label,Value` (or `X, Series 1,
 * Series 2` for line charts) table, so this renders it as an editable grid with
 * add/remove rows, paste-from-Excel, keyboard nav, Import CSV and Example - plus
 * a "Raw CSV" toggle for power users who want to paste or hand-edit the string.
 *
 * The grid serialises to exactly the CSV string the shared parser
 * (`shared/slide-types/chart/parse.js`) already eats, so nothing downstream
 * changes: this is purely an editing-UX layer. Used from three call sites (one
 * implementation): the side form (`slide-forms/chart.js`), the generic field
 * dispatcher (`render-field.js` `csv` branch) and the inline-edit modal
 * (`inline-editor.js` `openCsvModal`).
 */

import { h as defaultH } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { createSegmented } from '../../../lib/segmented.js';
import {
  detectHeaderRow,
  parseCsvToGrid,
  serializeCsv,
} from '../../../../shared/slide-types/chart/parse.js';

/**
 * Column shape per chart type. bar/pie are a fixed Label,Value pair; line is
 * X + one or two Y series (the second series is optional, add/remove-able).
 * @param {string} chartType
 */
function columnModel(chartType) {
  if (String(chartType) === 'line') {
    return { min: 2, max: 3, defaultHeaders: ['X', 'Series 1', 'Series 2'] };
  }
  return { min: 2, max: 2, defaultHeaders: ['Label', 'Value'] };
}

/** Seed data for the Example button, per chart type. */
function exampleFor(chartType) {
  return String(chartType) === 'line'
    ? 'X,Series 1,Series 2\nJan,12,8\nFeb,18,11\nMar,15,9'
    : 'Label,Value\nA,10\nB,25\nC,15';
}

/**
 * Turn a CSV string into `{ header, body, cols }` for the grid: an explicit
 * header row (detected via the same heuristic the renderer uses, or synthesised
 * from `defaultHeaders`), body rows normalised to `cols` columns.
 */
function buildMatrix(value, chartType, model) {
  const rows = parseCsvToGrid(value);
  let header;
  let body;
  if (rows.length && detectHeaderRow(chartType, rows)) {
    header = rows[0].slice();
    body = rows.slice(1).map((r) => r.slice());
  } else {
    header = [];
    body = rows.map((r) => r.slice());
  }

  const widest = body.reduce((m, r) => Math.max(m, r.length), 0);
  let cols = Math.max(model.min, header.length, widest);
  cols = Math.min(cols, model.max);

  const fit = (r) => {
    const out = r.slice(0, cols);
    while (out.length < cols) out.push('');
    return out;
  };
  header = fit(header).map((c, i) =>
    c && String(c).trim() ? c : model.defaultHeaders[i] || ''
  );
  body = body.map(fit);
  if (body.length === 0) body.push(new Array(cols).fill(''));
  return { header, body, cols };
}

/**
 * Compute the grid state after pasting a `matrix` (rows of strings) into a
 * header cell at `startCol`. Pure so it can be unit-tested without the DOM.
 *
 * - Into the **top-left** header cell it rebuilds the whole grid via
 *   {@link buildMatrix}, so the same header-detection the renderer applies
 *   decides whether the block's first row is column names or data - a headerless
 *   block keeps every row instead of losing row 0 to the header.
 * - Into **any other** header cell it fills in place from that column: the first
 *   pasted row sets the column name(s), following rows drop into the body at the
 *   same column offset, and other columns are preserved - so pasting a single
 *   series' values no longer wipes the rest of the grid.
 *
 * @param {Object} opts
 * @param {string[][]} opts.matrix - Parsed clipboard rows.
 * @param {number} opts.startCol - Header column the paste landed on.
 * @param {string[]} opts.header
 * @param {string[][]} opts.body
 * @param {number} opts.cols
 * @param {string} opts.chartType
 * @param {{min:number,max:number,defaultHeaders:string[]}} opts.model
 * @returns {{ header: string[], body: string[][], cols: number }}
 */
export function applyHeaderPaste({
  matrix,
  startCol,
  header,
  body,
  cols,
  chartType,
  model,
}) {
  if (!Array.isArray(matrix) || !matrix.length) return { header, body, cols };
  if (startCol === 0) return buildMatrix(serializeCsv(matrix), chartType, model);

  const nextHeader = header.slice();
  const nextBody = body.map((r) => r.slice());
  const [head, ...rest] = matrix;
  for (let ci = 0; ci < head.length; ci += 1) {
    const tc = startCol + ci;
    if (tc < cols) nextHeader[tc] = head[ci];
  }
  for (let ri = 0; ri < rest.length; ri += 1) {
    while (nextBody.length <= ri) nextBody.push(new Array(cols).fill(''));
    for (let ci = 0; ci < rest[ri].length; ci += 1) {
      const tc = startCol + ci;
      if (tc < cols) nextBody[ri][tc] = rest[ri][ci];
    }
  }
  return { header: nextHeader, body: nextBody, cols };
}

/**
 * Build a chart-data grid editor.
 *
 * @param {Object} opts
 * @param {Function} [opts.h] - DOM helper (defaults to shared `h()`).
 * @param {string} [opts.chartType] - 'bar' | 'line' | 'pie' (drives columns).
 * @param {string} [opts.value] - Initial CSV string.
 * @param {(csv: string) => void} [opts.onChange] - Called with the serialised
 *   CSV on every edit. The caller owns persistence / preview refresh.
 * @param {string} [opts.label] - Optional field label rendered above the editor.
 * @returns {{ el: HTMLElement }}
 */
export function createCsvGridEditor({
  h = defaultH,
  chartType = 'bar',
  value = '',
  onChange,
  label = '',
} = {}) {
  const model = columnModel(chartType);
  let mode = 'grid';
  let { header, body, cols } = buildMatrix(value, chartType, model);

  const contentHost = h('div', { class: 'csv-grid-host' });
  let tableEl = null;

  /** Drop trailing/interior all-empty body rows, then serialise header + body. */
  const currentCsv = () =>
    serializeCsv(
      [header, ...body].filter(
        (r, i) => i === 0 || r.some((c) => String(c).trim())
      )
    );

  const emit = () => onChange?.(currentCsv());

  // -- structural ops (re-render the grid) --------------------------------
  const focusCell = (r, c, caret = 'all') => {
    const input = tableEl?.querySelector(
      `input[data-r="${r}"][data-c="${c}"]`
    );
    if (!input) return;
    input.focus();
    if (caret === 'start') input.setSelectionRange?.(0, 0);
    else if (caret === 'end') {
      const n = input.value.length;
      input.setSelectionRange?.(n, n);
    } else input.select?.();
  };

  const addRow = () => {
    body.push(new Array(cols).fill(''));
    emit();
    renderContent();
  };

  const removeRow = (r) => {
    if (body.length <= 1) body[r] = new Array(cols).fill('');
    else body.splice(r, 1);
    emit();
    renderContent();
  };

  const addColumn = () => {
    if (cols >= model.max) return;
    cols += 1;
    while (header.length < cols)
      header.push(model.defaultHeaders[header.length] || '');
    body.forEach((row) => {
      while (row.length < cols) row.push('');
    });
    emit();
    renderContent();
  };

  const removeColumn = (c) => {
    if (cols <= model.min) return;
    cols -= 1;
    header.splice(c, 1);
    body.forEach((row) => row.splice(c, 1));
    emit();
    renderContent();
  };

  const loadValue = (text) => {
    const rebuilt = buildMatrix(text, chartType, model);
    header = rebuilt.header;
    body = rebuilt.body;
    cols = rebuilt.cols;
    emit();
    renderContent();
  };

  // -- paste (fill from clipboard TSV/CSV block) --------------------------
  const isMultiCell = (text) => /[\t\n]/.test(text) || /[,;].*[,;]/.test(text);

  const handleBodyPaste = (e, startRow, startCol) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!isMultiCell(text)) return; // single value: let the browser paste it
    e.preventDefault();
    const matrix = parseCsvToGrid(text);
    if (!matrix.length) return;
    for (let ri = 0; ri < matrix.length; ri += 1) {
      const tr = startRow + ri;
      while (body.length <= tr) body.push(new Array(cols).fill(''));
      for (let ci = 0; ci < matrix[ri].length; ci += 1) {
        const tc = startCol + ci;
        if (tc >= cols) continue;
        body[tr][tc] = matrix[ri][ci];
      }
    }
    emit();
    renderContent();
    focusCell(startRow, startCol);
  };

  // Paste into a header cell: the top-left cell rebuilds the whole grid (with
  // header auto-detection); any other header cell fills in place from that
  // column. See applyHeaderPaste for the full semantics.
  const handleHeaderPaste = (e, startCol) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!isMultiCell(text)) return;
    e.preventDefault();
    const matrix = parseCsvToGrid(text);
    if (!matrix.length) return;
    const next = applyHeaderPaste({
      matrix,
      startCol,
      header,
      body,
      cols,
      chartType,
      model,
    });
    header = next.header;
    body = next.body;
    if (typeof next.cols === 'number') cols = next.cols;
    emit();
    renderContent();
  };

  // -- keyboard nav -------------------------------------------------------
  // Enter walks down the column (adding a row past the last one); arrow keys
  // move between cells like a spreadsheet - Up/Down across rows (the header is
  // row -1), Left/Right hop columns only when the caret sits at the cell edge so
  // in-cell text editing still works. ⌘/Ctrl/Alt combos bubble untouched (the
  // inline modal binds ⌘/Ctrl+Enter to Save).
  const onCellKeydown = (e, rowIdx, colIdx) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (rowIdx === -1) {
        focusCell(0, colIdx);
        return;
      }
      if (rowIdx >= body.length - 1) addRow();
      focusCell(rowIdx + 1, colIdx);
      return;
    }

    const input = e.target;
    const len = input.value.length;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === len && input.selectionEnd === len;

    if (e.key === 'ArrowDown' && rowIdx < body.length - 1) {
      e.preventDefault();
      focusCell(rowIdx + 1, colIdx);
    } else if (e.key === 'ArrowUp' && rowIdx > -1) {
      e.preventDefault();
      focusCell(rowIdx - 1, colIdx);
    } else if (e.key === 'ArrowLeft' && atStart && colIdx > 0) {
      e.preventDefault();
      focusCell(rowIdx, colIdx - 1, 'end');
    } else if (e.key === 'ArrowRight' && atEnd && colIdx < cols - 1) {
      e.preventDefault();
      focusCell(rowIdx, colIdx + 1, 'start');
    }
  };

  // -- render -------------------------------------------------------------
  function renderGrid() {
    const wrap = h('div', { class: 'csv-grid-wrap' });
    const scroll = h('div', { class: 'csv-grid-scroll' });
    const table = h('table', { class: 'csv-grid' });
    tableEl = table;

    const thead = h('thead');
    const htr = h('tr');
    for (let c = 0; c < cols; c += 1) {
      const th = h('th', { class: 'csv-grid-th' });
      const inp = h('input', {
        class: 'csv-grid-input csv-grid-head-input',
        'data-r': '-1',
        'data-c': String(c),
        'aria-label': t('editor.chart.grid.columnName', 'Column {n} name', {
          n: c + 1,
        }),
      });
      inp.value = header[c] ?? '';
      inp.addEventListener('input', () => {
        header[c] = inp.value;
        emit();
      });
      inp.addEventListener('keydown', (e) => onCellKeydown(e, -1, c));
      inp.addEventListener('paste', (e) => handleHeaderPaste(e, c));
      th.append(inp);
      if (c >= model.min) {
        const rm = h('button', {
          class: 'csv-grid-colremove',
          type: 'button',
          text: '×',
          title: t('editor.chart.grid.removeSeries', 'Remove series'),
          'aria-label': t('editor.chart.grid.removeSeries', 'Remove series'),
          onclick: () => removeColumn(c),
        });
        th.append(rm);
      }
      htr.append(th);
    }
    htr.append(
      h('th', { class: 'csv-grid-th csv-grid-th-actions', 'aria-hidden': 'true' })
    );
    thead.append(htr);
    table.append(thead);

    const tbody = h('tbody');
    for (let r = 0; r < body.length; r += 1) {
      const tr = h('tr');
      for (let c = 0; c < cols; c += 1) {
        const td = h('td', { class: 'csv-grid-td' });
        const inp = h('input', {
          class: 'csv-grid-input',
          'data-r': String(r),
          'data-c': String(c),
        });
        inp.value = body[r][c] ?? '';
        // Value columns get a numeric keypad hint on touch devices.
        if (c >= 1) inp.setAttribute('inputmode', 'decimal');
        const rr = r;
        const cc = c;
        inp.addEventListener('input', () => {
          body[rr][cc] = inp.value;
          emit();
        });
        inp.addEventListener('keydown', (e) => onCellKeydown(e, rr, cc));
        inp.addEventListener('paste', (e) => handleBodyPaste(e, rr, cc));
        td.append(inp);
        tr.append(td);
      }
      const tdAct = h('td', { class: 'csv-grid-td csv-grid-td-actions' });
      const rm = h('button', {
        class: 'csv-grid-rowremove',
        type: 'button',
        text: '×',
        title: t('editor.chart.grid.removeRow', 'Remove row'),
        'aria-label': t('editor.chart.grid.removeRowN', 'Remove row {n}', {
          n: r + 1,
        }),
        onclick: () => removeRow(r),
      });
      tdAct.append(rm);
      tr.append(tdAct);
      tbody.append(tr);
    }
    table.append(tbody);
    scroll.append(table);
    wrap.append(scroll);

    const actions = h('div', { class: 'csv-grid-actions row is-wrap' });
    const addRowBtn = h('button', {
      class: 'btn btn-secondary is-compact-sm',
      type: 'button',
      text: t('editor.chart.grid.addRow', '+ Row'),
      onclick: () => {
        const at = body.length;
        addRow();
        focusCell(at, 0);
      },
    });
    actions.append(addRowBtn);
    if (cols < model.max) {
      actions.append(
        h('button', {
          class: 'btn btn-secondary is-compact-sm',
          type: 'button',
          text: t('editor.chart.grid.addSeries', '+ Series'),
          onclick: () => addColumn(),
        })
      );
    }
    wrap.append(actions);
    return wrap;
  }

  function renderRaw() {
    const ta = h('textarea', {
      class: 'form-input form-textarea-lg csv-grid-raw',
      spellcheck: 'false',
      autocapitalize: 'off',
      autocomplete: 'off',
      autocorrect: 'off',
    });
    ta.value = currentCsv();
    ta.addEventListener('input', () => {
      // Raw text is authoritative while in raw mode; keep the matrix in sync so
      // toggling back to the grid reflects the edits.
      onChange?.(ta.value);
      const rebuilt = buildMatrix(ta.value, chartType, model);
      header = rebuilt.header;
      body = rebuilt.body;
      cols = rebuilt.cols;
    });
    return ta;
  }

  function renderContent() {
    contentHost.innerHTML = '';
    contentHost.append(mode === 'raw' ? renderRaw() : renderGrid());
  }

  const seg = createSegmented({
    h,
    outlined: true,
    ariaLabel: t('editor.chart.grid.viewLabel', 'Data editor view'),
    segments: [
      { value: 'grid', label: t('editor.chart.grid.tabGrid', 'Grid') },
      { value: 'raw', label: t('editor.chart.grid.tabRaw', 'Raw CSV') },
    ],
    value: mode,
    onSelect: (v) => {
      if (v === mode) return;
      mode = v;
      renderContent();
    },
  });

  const fileInput = h('input', {
    type: 'file',
    accept: '.csv,.tsv,text/csv',
    hidden: true,
  });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      loadValue(await f.text());
    } catch {
      /* ignore unreadable file */
    } finally {
      fileInput.value = '';
    }
  });

  const toolbar = h('div', { class: 'csv-grid-toolbar row spread is-wrap' }, [
    seg.el,
    h('div', { class: 'row is-wrap csv-grid-toolbar-actions' }, [
      h('button', {
        class: 'btn btn-secondary is-compact-sm',
        type: 'button',
        text: t('editor.chart.importCsv', 'Import CSV'),
        onclick: () => fileInput.click(),
      }),
      h('button', {
        class: 'btn btn-secondary is-compact-sm',
        type: 'button',
        text: t('editor.chart.example', 'Example'),
        onclick: () => loadValue(exampleFor(chartType)),
      }),
      fileInput,
    ]),
  ]);

  const help = h('div', {
    class: 'help',
    text:
      String(chartType) === 'line'
        ? t(
            'editor.chart.grid.helpLine',
            'X label in the first column, then one or two numeric series. The header row sets the series names.'
          )
        : t(
            'editor.chart.grid.helpBarPie',
            'A label and a numeric value per row. Paste a block from Sheets/Excel into any cell.'
          ),
  });

  const children = [];
  if (label) children.push(h('div', { class: 'field-label', text: label }));
  children.push(toolbar, contentHost, help);
  const el = h('div', { class: 'stack is-field is-field-full csv-grid-field' }, children);

  renderContent();
  return { el };
}
