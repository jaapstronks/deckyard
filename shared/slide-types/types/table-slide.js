import { bgClass, esc, BACKGROUND_FIELD, TABLE_STYLE_FIELD, tableStyleClass } from '../helpers.js';
import { inlineMarkdownToSafeHtml } from '../../markdown.js';

export const MAX_COLS = 10;
export const MAX_ROWS = 40;

function clampInt(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

function colCountFromContent(content) {
  return clampInt(content?.colCount || 4, 1, MAX_COLS);
}

function normalizeRows(content, colCount) {
  const raw = Array.isArray(content?.rows) ? content.rows : [];
  const rows = raw
    .filter((r) => r && typeof r === 'object')
    .slice(0, MAX_ROWS)
    .map((r) => {
      const out = {};
      for (let c = 1; c <= colCount; c += 1) {
        const k = `c${c}`;
        out[k] = typeof r?.[k] === 'string' ? r[k] : '';
      }
      return out;
    });
  return rows;
}

function rowToCellsHtml(rowObj, colCount, cellTag, stepByCell = false, rowIdx = -1) {
  let out = '';
  for (let c = 1; c <= colCount; c += 1) {
    const k = `c${c}`;
    const v = rowObj?.[k] || '';
    const cellClass = stepByCell ? ' class="table-step-cell"' : '';
    // rowIdx < 0 marks the layout-stability placeholder row (not real data).
    const inlineAttr = rowIdx >= 0 ? ` data-inline-field="rows.${rowIdx}.${k}"` : '';
    out += `<${cellTag}${cellClass}${inlineAttr} dir="auto">${inlineMarkdownToSafeHtml(v)}</${cellTag}>`;
  }
  return out;
}

export default {
  label: 'Table',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'caption',
      label: 'Caption',
      type: 'string',
      required: false,
      maxLength: 240,
    },
    {
      key: 'headerRow',
      label: 'Header row',
      type: 'enum',
      required: false,
      options: ['on', 'off'],
    },
    {
      key: 'animateByCell',
      label: 'Animate by cell',
      type: 'enum',
      required: false,
      options: ['off', 'on'],
    },
    {
      key: 'colCount',
      label: 'Columns',
      type: 'enum',
      required: false,
      options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    },
    {
      key: 'rows',
      label: 'Rows',
      type: 'items',
      required: false,
      maxItems: MAX_ROWS,
      itemFields: Array.from({ length: MAX_COLS }, (_v, idx) => ({
        key: `c${idx + 1}`,
        label: `C${idx + 1}`,
        type: 'string',
        required: false,
        maxLength: 400,
      })),
    },
    TABLE_STYLE_FIELD,
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'Nieuwe tabel',
      caption: '',
      headerRow: 'on',
      animateByCell: 'off',
      colCount: '4',
      rows: [
        { c1: 'Kolom A', c2: 'Kolom B', c3: 'Kolom C', c4: 'Kolom D' },
        { c1: 'Rij 1', c2: '…', c3: '…', c4: '…' },
        { c1: 'Rij 2', c2: '…', c3: '…', c4: '…' },
      ],
      tableStyle: 'plain',
      background: 'lime',
    },
    'en-GB': {
      title: 'New table',
      caption: '',
      headerRow: 'on',
      animateByCell: 'off',
      colCount: '4',
      rows: [
        { c1: 'Column A', c2: 'Column B', c3: 'Column C', c4: 'Column D' },
        { c1: 'Row 1', c2: '…', c3: '…', c4: '…' },
        { c1: 'Row 2', c2: '…', c3: '…', c4: '…' },
      ],
      tableStyle: 'plain',
      background: 'lime',
    },
  },
  // Back-compat fallback
  defaults: {
    title: 'New table',
    caption: '',
    headerRow: 'on',
    animateByCell: 'off',
    colCount: '4',
    rows: [
      { c1: 'Column A', c2: 'Column B', c3: 'Column C', c4: 'Column D' },
      { c1: 'Row 1', c2: '…', c3: '…', c4: '…' },
      { c1: 'Row 2', c2: '…', c3: '…', c4: '…' },
    ],
    tableStyle: 'plain',
    background: 'lime',
  },
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const tableStyle = tableStyleClass(content?.tableStyle);
    const colCount = colCountFromContent(content);
    const rows = normalizeRows(content, colCount);
    const animateByCell = String(content?.animateByCell || 'off') === 'on';

    const headerEnabled = String(content?.headerRow || 'on') !== 'off';
    const hasHeader = headerEnabled && rows.length > 0;
    const header = hasHeader ? rows[0] : null;
    const bodyRows = hasHeader ? rows.slice(1) : rows;

    // Header row: if stepping by cell, mark individual cells; otherwise no step class on header
    const thead = header
      ? `<thead><tr data-inline-item="rows" data-inline-item-index="0">${rowToCellsHtml(header, colCount, 'th', animateByCell, 0)}</tr></thead>`
      : '';

    const safeBody =
      bodyRows.length > 0
        ? bodyRows
        : [
            // Render a minimal empty table to keep layout stable.
            Object.fromEntries(
              Array.from({ length: colCount }, (_v, idx) => [
                `c${idx + 1}`,
                '',
              ])
            ),
          ];

    // Body rows: if stepping by cell, mark cells; otherwise mark entire row
    const isPlaceholderBody = bodyRows.length === 0;
    const tbody = `<tbody>${safeBody
      .map((r, i) => {
        const rowClass = animateByCell ? '' : ' class="table-step-row"';
        const rowIdx = isPlaceholderBody ? -1 : hasHeader ? i + 1 : i;
        const itemAttrs = rowIdx >= 0 ? ` data-inline-item="rows" data-inline-item-index="${rowIdx}"` : '';
        return `<tr${rowClass}${itemAttrs}>${rowToCellsHtml(r, colCount, 'td', animateByCell, rowIdx)}</tr>`;
      })
      .join('')}</tbody>`;

    const caption = String(content?.caption || '').trim();
    const captionHtml = caption
      ? `<div class="table-caption" data-inline-field="caption" dir="auto">${esc(caption)}</div>`
      : '';

    return `
      <div class="slide slide-table ${bg}">
        <div class="slide-inner">
          <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
          <div class="md-table-wrap">
            <table class="md-table ${tableStyle}">
              ${thead}
              ${tbody}
            </table>
          </div>
          ${captionHtml}
        </div>
      </div>
    `;
  },
};
