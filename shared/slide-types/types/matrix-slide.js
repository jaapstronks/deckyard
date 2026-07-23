import {
  bgClass,
  esc,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

function safeItemsArr(items) {
  return Array.isArray(items) ? items : [];
}

const POSITIONS = ['tl', 'tr', 'bl', 'br'];
const VALID_TONES = ['default', 'positive', 'negative', 'neutral'];

function cellHtml(cell, idx) {
  const position = POSITIONS[idx] || 'tl';
  const title = typeof cell?.title === 'string' ? cell.title.trim() : '';
  const body = typeof cell?.body === 'string' ? cell.body.trim() : '';
  const toneRaw = typeof cell?.tone === 'string' ? cell.tone.trim() : 'default';
  const tone = VALID_TONES.includes(toneRaw) ? toneRaw : 'default';

  const titleHtml = title
    ? `<h3 class="cell-title" data-inline-field="cells.${idx}.title" dir="auto">${esc(title)}</h3>`
    : '';
  const bodyHtml = body
    ? `<div class="cell-body" data-inline-field="cells.${idx}.body">${markdownToSafeHtml(body)}</div>`
    : '';

  return `
    <div class="matrix-cell" data-position="${position}" data-tone="${tone}" role="region" aria-label="${esc(title || `Cell ${idx + 1}`)}" data-inline-item="cells" data-inline-item-index="${idx}">
      ${titleHtml}
      ${bodyHtml}
    </div>
  `;
}

export default {
  label: 'Matrix',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
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
    {
      key: 'cells',
      label: 'Cells',
      type: 'items',
      required: true,
      minItems: 4,
      maxItems: 4,
      itemDefaults: {
        title: 'Cell',
        body: '- Item 1\n- Item 2',
        tone: 'default',
      },
      itemFields: [
        {
          key: 'title',
          label: 'Cell title',
          type: 'string',
          required: true,
          maxLength: 40,
        },
        {
          key: 'body',
          label: 'Cell content',
          type: 'markdown',
          required: true,
          maxLength: 1000,
        },
        {
          key: 'tone',
          label: 'Tone',
          type: 'enum',
          required: false,
          options: [
            { value: 'default', label: 'Default' },
            { value: 'positive', label: 'Positive (green)' },
            { value: 'negative', label: 'Negative (red)' },
            { value: 'neutral', label: 'Neutral (gray)' },
          ],
        },
      ],
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'SWOT Analyse',
      subheading: '',
      bottomSubheading: '',
      cells: [
        {
          title: 'Sterktes',
          body: '- Sterke merkherkenning\n- Ervaren team\n- Loyale klanten',
          tone: 'positive',
        },
        {
          title: 'Zwaktes',
          body: '- Beperkt budget\n- Kleine marktpositie\n- Afhankelijk van leveranciers',
          tone: 'negative',
        },
        {
          title: 'Kansen',
          body: '- Groeiende markt\n- Nieuwe technologie\n- Internationale expansie',
          tone: 'positive',
        },
        {
          title: 'Bedreigingen',
          body: '- Sterke concurrentie\n- Regelgeving\n- Economische onzekerheid',
          tone: 'negative',
        },
      ],
      background: 'mist',
    },
    'en-GB': {
      title: 'SWOT Analysis',
      subheading: '',
      bottomSubheading: '',
      cells: [
        {
          title: 'Strengths',
          body: '- Strong brand recognition\n- Experienced team\n- Loyal customer base',
          tone: 'positive',
        },
        {
          title: 'Weaknesses',
          body: '- Limited budget\n- Small market share\n- Supplier dependency',
          tone: 'negative',
        },
        {
          title: 'Opportunities',
          body: '- Growing market\n- New technology\n- International expansion',
          tone: 'positive',
        },
        {
          title: 'Threats',
          body: '- Strong competition\n- Regulatory changes\n- Economic uncertainty',
          tone: 'negative',
        },
      ],
      background: 'mist',
    },
  },
  defaults: {
    title: 'SWOT Analysis',
    subheading: '',
    bottomSubheading: '',
    cells: [
      {
        title: 'Strengths',
        body: '- Strong brand recognition\n- Experienced team\n- Loyal customer base',
        tone: 'positive',
      },
      {
        title: 'Weaknesses',
        body: '- Limited budget\n- Small market share\n- Supplier dependency',
        tone: 'negative',
      },
      {
        title: 'Opportunities',
        body: '- Growing market\n- New technology\n- International expansion',
        tone: 'positive',
      },
      {
        title: 'Threats',
        body: '- Strong competition\n- Regulatory changes\n- Economic uncertainty',
        tone: 'negative',
      },
    ],
    background: 'mist',
  },
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
        : '';
    const subheadingHtml = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const hasHeader = !!(title || subheadingHtml);

    // Always render exactly 4 cells
    const cells = safeItemsArr(content?.cells).slice(0, 4);
    // Pad with empty cells if needed
    while (cells.length < 4) {
      cells.push({ title: '', body: '', tone: 'default' });
    }

    const cellsHtml = cells.map((cell, idx) => cellHtml(cell, idx)).join('');

    return `
      <div class="slide slide-matrix ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <div class="matrix-grid">
            ${cellsHtml}
          </div>
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};