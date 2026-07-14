import {
  bgClass,
  esc,
  getSubheadingText,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
  clampInt,
} from '../helpers.js';

function safeLevelsArr(levels) {
  return Array.isArray(levels) ? levels : [];
}

function levelHtml(level, idx, total) {
  const label = typeof level?.label === 'string' ? level.label.trim() : '';
  const text = typeof level?.text === 'string' ? level.text.trim() : '';
  const levelNum = idx + 1;

  const labelHtml = label
    ? `<div class="level-label" data-inline-field="levels.${idx}.label" dir="auto">${esc(label)}</div>`
    : '';
  const textHtml = text
    ? `<div class="level-text" data-inline-field="levels.${idx}.text" dir="auto">${esc(text)}</div>`
    : '';

  // Calculate width percentage for pyramid effect (widening from top to bottom)
  // Top level is narrowest, bottom level is widest
  const widthPercent = 30 + (idx / Math.max(total - 1, 1)) * 60;

  return `
    <div class="pyramid-level" data-level="${levelNum}" style="--level-width: ${widthPercent}%;" role="listitem" data-inline-item="levels" data-inline-item-index="${idx}"
      <div class="level-bar">
        <div class="level-content">
          ${labelHtml}
          ${textHtml}
        </div>
      </div>
    </div>
  `;
}

export default {
  label: 'Pyramid',
  fields: [
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
    {
      key: 'levels',
      label: 'Levels',
      type: 'items',
      required: true,
      minItems: 3,
      maxItems: 6,
      itemDefaults: {
        label: 'Level',
        text: '',
      },
      itemFields: [
        {
          key: 'label',
          label: 'Level label',
          type: 'string',
          required: true,
          maxLength: 60,
        },
        {
          key: 'text',
          label: 'Description',
          type: 'string',
          required: false,
          maxLength: 120,
        },
      ],
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'Maslow\'s piramide',
      subheading: '',
      bottomSubheading: '',
      levels: [
        { label: 'Zelfrealisatie', text: 'Persoonlijke groei en vervulling' },
        { label: 'Waardering', text: 'Erkenning en respect' },
        { label: 'Sociaal', text: 'Liefde en verbondenheid' },
        { label: 'Veiligheid', text: 'Zekerheid en stabiliteit' },
        { label: 'Fysiologisch', text: 'Basisbehoeften' },
      ],
      background: 'mist',
    },
    'en-GB': {
      title: 'Maslow\'s hierarchy',
      subheading: '',
      bottomSubheading: '',
      levels: [
        { label: 'Self-actualisation', text: 'Personal growth and fulfilment' },
        { label: 'Esteem', text: 'Recognition and respect' },
        { label: 'Belonging', text: 'Love and connection' },
        { label: 'Safety', text: 'Security and stability' },
        { label: 'Physiological', text: 'Basic needs' },
      ],
      background: 'mist',
    },
  },
  defaults: {
    title: 'Maslow\'s hierarchy',
    subheading: '',
    bottomSubheading: '',
    levels: [
      { label: 'Self-actualisation', text: 'Personal growth and fulfilment' },
      { label: 'Esteem', text: 'Recognition and respect' },
      { label: 'Belonging', text: 'Love and connection' },
      { label: 'Safety', text: 'Security and stability' },
      { label: 'Physiological', text: 'Basic needs' },
    ],
    background: 'mist',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
        : '';
    const subText = getSubheadingText(content);
    const subheadingHtml = subText ? `<p class="subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(subText)}</p>` : '';
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const hasHeader = !!(title || subheadingHtml);

    const levels = safeLevelsArr(content?.levels).slice(0, 6);
    const count = clampInt(levels.length, 3, 6, 5);

    const levelsHtml = levels
      .slice(0, count)
      .map((level, idx) => levelHtml(level, idx, count))
      .join('');

    return `
      <div class="slide slide-pyramid ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <div class="pyramid-container" data-count="${count}" role="list" aria-label="Pyramid levels">
            ${levelsHtml}
          </div>
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};