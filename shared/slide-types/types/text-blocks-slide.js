import {
  escapeHtml,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
} from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';

/** Header alignment moves title and subheading together; the group's
 * alignment class overrides the centred default. */
const HEADER_BLOCK = alignGroup('header-block', 'headerAlign', {
  align: ['center', 'left'],
  label: 'Header alignment',
  labelKey: 'editor.slideField.headerAlign.label',
  schematicKind: 'blocks',
});

/**
 * Resolve rows from content: the stored `rows[]`, with each row's defaults
 * filled in. An empty or absent `rows` is a slide with no rows yet (the editor
 * offers "+ Add row"). The numbered `row{N}…` fields of v1 decks never reach
 * here: the v1 -> v2 step folds them into `rows[]` and drops them (D216).
 *
 * Returns: [{ title, color, arrow, blocks: [{ title, body }] }, ...]
 */
export function resolveRows(content) {
  if (!Array.isArray(content?.rows)) return [];
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

function generateDefaultRows(lang) {
  const blockLabels =
    lang === 'nl' ? ['Blok', 'Tekst hier'] : ['Block', 'Text here'];
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
  structure: 'collection',
  fallback: 'list-slide',
  runtime: 'static',
  fidelity: { pptx: 'raster' },
  fieldGroups: [HEADER_BLOCK.group],
  layoutVariants: HEADER_BLOCK.variants,
  label: 'Text blocks',
  fields: [
    // Header
    {
      key: 'title',
      essential: true,
      role: 'heading',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: true,
      maxLength: 120,
      group: 'header-block',
    },
    {
      key: 'subheading',
      label: 'Subheading',
      labelKey: 'editor.slideField.subheading.label',
      type: 'string',
      required: false,
      maxLength: 200,
      group: 'header-block',
    },

    {
      key: 'rows',
      essential: true,
      label: 'Rows',
      labelKey: 'editor.slideField.rows.label',
      type: 'items',
      required: false,
      minItems: 1,
      maxItems: 4,
      collapsible: true, // per-row collapse in the editor (blocks stay flat)
      // The per-row `arrow` is a typed relation to the NEXT row, not content:
      // "down" ≈ leads-to, "up" ≈ follows-from. In the reader/reflow projection
      // this turns the rows into an ordered causal sequence (<ol>) with a small
      // relation marker between rows, named by the option's `copyKey`; "none"
      // carries no copy key and so no relation. See semantic-projection.js
      // (the `relationField` mechanism).
      relationField: 'arrow',
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
      itemDefaultsByLang: {
        nl: {
          title: '',
          color: 'yellow',
          arrow: 'none',
          blocks: [
            { title: 'Blok 1', body: '' },
            { title: 'Blok 2', body: '' },
            { title: 'Blok 3', body: '' },
          ],
        },
      },
      itemFields: [
        // `.text-blocks-row-title` is centred (80-text-blocks.css).
        {
          key: 'title',
          label: 'Row heading',
          type: 'string',
          required: false,
          maxLength: 120,
          defaultAlign: 'center',
        },
        {
          key: 'color',
          label: 'Color',
          type: 'enum',
          required: false,
          options: [
            { value: 'yellow', label: 'Yellow' },
            { value: 'black', label: 'Black' },
          ],
        },
        {
          key: 'blocks',
          label: 'Blocks',
          type: 'items',
          required: false,
          minItems: 1,
          maxItems: 6,
          itemDefaults: { title: 'Block', body: 'Text here' },
          itemDefaultsByLang: {
            nl: { title: 'Blok', body: 'Tekst hier' },
          },
          itemFields: [
            {
              key: 'title',
              label: 'Title',
              labelKey: 'editor.slideField.title.label',
              type: 'string',
              required: false,
              maxLength: 80,
            },
            {
              key: 'body',
              label: 'Body',
              type: 'markdown',
              required: false,
              maxLength: 500,
            },
          ],
        },
        {
          key: 'arrow',
          label: 'Arrow after row',
          type: 'enum',
          required: false,
          options: [
            { value: 'none', label: 'None' },
            { value: 'down', label: 'Down ↓', copyKey: 'relationLeadsTo' },
            { value: 'up', label: 'Up ↑', copyKey: 'relationFollowsFrom' },
          ],
        },
      ],
    },

    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      labelKey: 'editor.slideField.bottomSubheading.label',
      type: 'string',
      required: false,
      maxLength: 200,
    },

    // Last, because it has no primary home in the form: the toolbar "Layout"
    // chip owns the header block's alignment (see field-groups.js).
    HEADER_BLOCK.field,
  ],

  defaultsByLang: {
    nl: {
      headerAlign: 'center',
      title: 'Tekstblokken',
      subheading: '',
      bottomSubheading: '',
      rows: generateDefaultRows('nl'),
    },
    'en-GB': {
      headerAlign: 'center',
      title: 'Text blocks',
      subheading: '',
      bottomSubheading: '',
      rows: generateDefaultRows('en'),
    },
  },

  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    headerAlign: 'center',
    title: 'Text blocks',
    subheading: '',
    bottomSubheading: '',
    rows: generateDefaultRows('en'),
  },

  renderHtml: (content) => {
    const title = escapeHtml(content?.title || '');
    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const bottomSubheading = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);

    const alignClass = groupAlignClass(HEADER_BLOCK.group, content);
    const rows = resolveRows(content);
    const rowCount = rows.length;

    function renderArrow(arrowValue) {
      if (!arrowValue || arrowValue === 'none') return '';
      const arrowChar = arrowValue === 'up' ? '↑' : '↓';
      return `<div class="text-blocks-arrow text-blocks-step" aria-hidden="true">${arrowChar}</div>`;
    }

    function renderRow(row, rowIdx) {
      const colorClass = row.color === 'black' ? 'is-black' : 'is-yellow';

      let rowTitleHtml = '';
      if (row.title) {
        rowTitleHtml = `<h3 class="text-blocks-row-title text-blocks-step" data-inline-field="rows.${rowIdx}.title" dir="auto">${escapeHtml(row.title)}</h3>`;
      }

      const blockCount = row.blocks.length || 1;
      const blockHtmls = row.blocks.map((block, bIdx) => {
        const blockPath = `rows.${rowIdx}.blocks.${bIdx}`;
        const titleHtml = block.title
          ? `<div class="text-block-title" data-inline-field="${blockPath}.title" dir="auto">${escapeHtml(block.title)}</div>`
          : '';
        const bodyHtml = block.body
          ? `<div class="text-block-body" data-inline-field="${blockPath}.body">${markdownToSafeHtml(block.body)}</div>`
          : '';
        return `
          <div class="text-block text-blocks-step ${colorClass}" data-inline-item-index="${bIdx}">
            ${titleHtml}
            ${bodyHtml}
          </div>
        `;
      });

      return `
        ${rowTitleHtml}
        <div class="text-blocks-row" data-count="${blockCount}" data-inline-item-index="${rowIdx}">
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
      <div class="slide slide-text-blocks slide-bg-mist${hasBottom ? ' has-bottom-subheading' : ''}${alignClass ? ` ${alignClass}` : ''}">
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
