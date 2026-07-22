import {
  esc,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
} from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

/**
 * Resolve rows from content — supports both legacy numbered fields
 * (row1Block1Title, row1Count, etc.) and the new rows[] array.
 * rows[] takes precedence when present.
 *
 * Returns: [{ title, color, arrow, blocks: [{ title, body }] }, ...]
 */
function resolveRows(content) {
  // New format: rows[] array
  if (Array.isArray(content?.rows) && content.rows.length > 0) {
    return content.rows.map((row, idx) => ({
      title: String(row.title || '').trim(),
      color: row.color || (idx % 2 === 0 ? 'yellow' : 'black'),
      arrow: row.arrow || 'none',
      blocks: Array.isArray(row.blocks)
        ? row.blocks.map((b) => ({
            title: String(b?.title || '').trim(),
            body: String(b?.body || '').trim(),
          }))
        : [],
    }));
  }

  // Legacy format: row{N}Block{M}Title, row{N}Count, etc.
  const rows = [];

  // Row 1 always exists
  const row1Count = Math.max(1, Math.min(6, Number(content?.row1Count) || 3));
  const row1Blocks = [];
  for (let i = 1; i <= row1Count; i++) {
    row1Blocks.push({
      title: String(content?.[`row1Block${i}Title`] || '').trim(),
      body: String(content?.[`row1Block${i}Body`] || '').trim(),
    });
  }
  rows.push({
    title: '',
    color: content?.row1Color || 'yellow',
    arrow: content?.arrow1 || 'none',
    blocks: row1Blocks,
  });

  // Row 2 (optional)
  if (content?.row2Enabled === 'yes') {
    const row2Count = Math.max(1, Math.min(6, Number(content?.row2Count) || 3));
    const row2Blocks = [];
    for (let i = 1; i <= row2Count; i++) {
      row2Blocks.push({
        title: String(content?.[`row2Block${i}Title`] || '').trim(),
        body: String(content?.[`row2Block${i}Body`] || '').trim(),
      });
    }
    rows.push({
      title: String(content?.row2Title || '').trim(),
      color: content?.row2Color || 'black',
      arrow: content?.arrow2 || 'none',
      blocks: row2Blocks,
    });
  }

  // Row 3 (optional)
  if (content?.row3Enabled === 'yes') {
    const row3Count = Math.max(1, Math.min(6, Number(content?.row3Count) || 3));
    const row3Blocks = [];
    for (let i = 1; i <= row3Count; i++) {
      row3Blocks.push({
        title: String(content?.[`row3Block${i}Title`] || '').trim(),
        body: String(content?.[`row3Block${i}Body`] || '').trim(),
      });
    }
    rows.push({
      title: String(content?.row3Title || '').trim(),
      color: content?.row3Color || 'yellow',
      arrow: 'none', // no arrow after last row
      blocks: row3Blocks,
    });
  }

  return rows;
}

function generateBlockFields(rowNum) {
  const fields = [];
  for (let i = 1; i <= 6; i++) {
    fields.push({
      key: `row${rowNum}Block${i}Title`,
      label: `Row ${rowNum} Block ${i} title`,
      type: 'string',
      required: false,
      maxLength: 80,
    });
    fields.push({
      key: `row${rowNum}Block${i}Body`,
      label: `Row ${rowNum} Block ${i} body`,
      type: 'markdown',
      required: false,
      maxLength: 500,
    });
  }
  return fields;
}

function generateDefaultRows(lang) {
  const blockLabels = lang === 'nl'
    ? ['Blok', 'Tekst hier']
    : ['Block', 'Text here'];
  return [
    {
      title: '',
      color: 'yellow',
      arrow: 'none',
      blocks: Array.from({ length: 3 }, (_, i) => ({
        title: `${blockLabels[0]} ${i + 1}`,
        body: blockLabels[1],
      })),
    },
  ];
}

export default {
  label: 'Text blocks',
  fields: [
    // Header
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },

    // New rows[] format (preferred for AI generation)
    {
      key: 'rows',
      label: 'Rows',
      type: 'items',
      required: false,
      minItems: 1,
      maxItems: 3,
      // Starter blocks so a freshly-added row renders visible, clickable cards
      // (an empty blocks[] would render a zero-height row with nothing to edit).
      itemDefaults: {
        title: '',
        color: 'yellow',
        arrow: 'none',
        blocks: [
          { title: 'Block 1', body: '' },
          { title: 'Block 2', body: '' },
          { title: 'Block 3', body: '' },
        ],
      },
      itemFields: [
        { key: 'title', label: 'Row heading', type: 'string', required: false, maxLength: 120 },
        { key: 'color', label: 'Color', type: 'enum', required: false, options: ['yellow', 'black'] },
        { key: 'arrow', label: 'Arrow after row', type: 'enum', required: false, options: ['none', 'down', 'up'] },
        {
          key: 'blocks',
          label: 'Blocks',
          type: 'items',
          required: false,
          minItems: 1,
          maxItems: 6,
          itemDefaults: { title: 'Block', body: 'Text here' },
          itemFields: [
            { key: 'title', label: 'Title', type: 'string', required: false, maxLength: 80 },
            { key: 'body', label: 'Body', type: 'markdown', required: false, maxLength: 500 },
          ],
        },
      ],
    },

    // LEGACY: numbered row/block fields (row1Count, row1Block1Title, etc.)
    // Kept for backward compatibility with existing slides and editor form.

    // Row 1 (always visible)
    {
      key: 'row1Count',
      label: 'Row 1 blocks',
      type: 'enum',
      required: false,
      options: ['1', '2', '3', '4', '5', '6'],
    },
    {
      key: 'row1Color',
      label: 'Row 1 color',
      type: 'enum',
      required: false,
      options: [
        { value: 'yellow', label: 'Accent' },
        { value: 'black', label: 'Dark' },
      ],
    },
    ...generateBlockFields(1),

    // Arrow 1 (between row 1 and 2)
    {
      key: 'arrow1',
      label: 'Arrow after row 1',
      type: 'enum',
      required: false,
      options: [
        { value: 'none', label: 'None' },
        { value: 'down', label: 'Down' },
        { value: 'up', label: 'Up' },
      ],
    },

    // Row 2 (optional)
    {
      key: 'row2Enabled',
      label: 'Row 2',
      type: 'enum',
      required: false,
      options: [
        { value: 'no', label: 'Disabled' },
        { value: 'yes', label: 'Enabled' },
      ],
    },
    {
      key: 'row2Title',
      label: 'Row 2 heading',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'row2Count',
      label: 'Row 2 blocks',
      type: 'enum',
      required: false,
      options: ['1', '2', '3', '4', '5', '6'],
    },
    {
      key: 'row2Color',
      label: 'Row 2 color',
      type: 'enum',
      required: false,
      options: [
        { value: 'yellow', label: 'Accent' },
        { value: 'black', label: 'Dark' },
      ],
    },
    ...generateBlockFields(2),

    // Arrow 2 (between row 2 and 3)
    {
      key: 'arrow2',
      label: 'Arrow after row 2',
      type: 'enum',
      required: false,
      options: [
        { value: 'none', label: 'None' },
        { value: 'down', label: 'Down' },
        { value: 'up', label: 'Up' },
      ],
    },

    // Row 3 (optional)
    {
      key: 'row3Enabled',
      label: 'Row 3',
      type: 'enum',
      required: false,
      options: [
        { value: 'no', label: 'Disabled' },
        { value: 'yes', label: 'Enabled' },
      ],
    },
    {
      key: 'row3Title',
      label: 'Row 3 heading',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'row3Count',
      label: 'Row 3 blocks',
      type: 'enum',
      required: false,
      options: ['1', '2', '3', '4', '5', '6'],
    },
    {
      key: 'row3Color',
      label: 'Row 3 color',
      type: 'enum',
      required: false,
      options: [
        { value: 'yellow', label: 'Accent' },
        { value: 'black', label: 'Dark' },
      ],
    },
    ...generateBlockFields(3),
  ],

  // Defaults are array-canonical: new slides start in the rows[] shape.
  // Legacy numbered decks keep working via resolveRows()'s dual-read.
  defaultsByLang: {
    nl: {
      title: 'Tekstblokken',
      subheading: '',
      bottomSubheading: '',
      rows: generateDefaultRows('nl'),
    },
    'en-GB': {
      title: 'Text blocks',
      subheading: '',
      bottomSubheading: '',
      rows: generateDefaultRows('en'),
    },
  },

  defaults: {
    title: 'Text blocks',
    subheading: '',
    bottomSubheading: '',
    rows: generateDefaultRows('en'),
  },

  renderHtml: (content) => {
    const title = esc(content?.title || '');
    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const bottomSubheading = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);

    const rows = resolveRows(content);
    const rowCount = rows.length;
    // Inline-edit paths must point at the data source resolveRows() used.
    const useRows = Array.isArray(content?.rows) && content.rows.length > 0;

    function renderArrow(arrowValue) {
      if (!arrowValue || arrowValue === 'none') return '';
      const arrowChar = arrowValue === 'up' ? '↑' : '↓';
      return `<div class="text-blocks-arrow text-blocks-step" aria-hidden="true">${arrowChar}</div>`;
    }

    function renderRow(row, rowIdx) {
      const colorClass = row.color === 'black' ? 'is-black' : 'is-yellow';

      let rowTitleHtml = '';
      if (rowIdx > 0 && row.title) {
        const rowTitlePath = useRows ? `rows.${rowIdx}.title` : `row${rowIdx + 1}Title`;
        rowTitleHtml = `<h3 class="text-blocks-row-title text-blocks-step" data-inline-field="${rowTitlePath}" dir="auto">${esc(row.title)}</h3>`;
      }

      const blockCount = row.blocks.length || 1;
      const blockHtmls = row.blocks.map((block, bIdx) => {
        const blockTitlePath = useRows
          ? `rows.${rowIdx}.blocks.${bIdx}.title`
          : `row${rowIdx + 1}Block${bIdx + 1}Title`;
        const blockBodyPath = useRows
          ? `rows.${rowIdx}.blocks.${bIdx}.body`
          : `row${rowIdx + 1}Block${bIdx + 1}Body`;
        const titleHtml = block.title
          ? `<div class="text-block-title" data-inline-field="${blockTitlePath}" dir="auto">${esc(block.title)}</div>`
          : '';
        const bodyHtml = block.body
          ? `<div class="text-block-body" data-inline-field="${blockBodyPath}">${markdownToSafeHtml(block.body)}</div>`
          : '';
        // Item indexes only in array mode: the inline editor's card add/remove
        // writes to rows[], so legacy numbered decks must not grow affordances.
        const blockItemAttr = useRows ? ` data-inline-item-index="${bIdx}"` : '';
        return `
          <div class="text-block text-blocks-step ${colorClass}"${blockItemAttr}>
            ${titleHtml}
            ${bodyHtml}
          </div>
        `;
      });

      const rowItemAttr = useRows ? ` data-inline-item-index="${rowIdx}"` : '';
      return `
        ${rowTitleHtml}
        <div class="text-blocks-row" data-count="${blockCount}"${rowItemAttr}>
          ${blockHtmls.join('')}
        </div>
      `;
    }

    // Build content: rows interleaved with arrows
    const contentParts = [];
    rows.forEach((row, idx) => {
      contentParts.push(renderRow(row, idx));
      // Arrow after this row (except last row)
      if (idx < rows.length - 1) {
        contentParts.push(renderArrow(row.arrow));
      }
    });

    return `
      <div class="slide slide-text-blocks slide-bg-mist${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          <div class="header">
            <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${title}</h2>
            ${subheading}
          </div>
          <div class="text-blocks-content" data-rows="${rowCount}">
            ${contentParts.join('')}
          </div>
          ${bottomSubheading}
        </div>
      </div>
    `;
  },
};