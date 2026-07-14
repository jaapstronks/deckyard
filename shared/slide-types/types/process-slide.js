import {
  bgClass,
  esc,
  getSubheadingText,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
  clampInt,
  getCollectionItems,
  getCollectionKey,
} from '../helpers.js';

function safeItemsArr(items) {
  return Array.isArray(items) ? items : [];
}

function stepHtml(step, idx, total, direction, colKey = 'items') {
  const title = typeof step?.title === 'string' ? step.title.trim() : '';
  const text = typeof step?.text === 'string' ? step.text.trim() : '';
  const stepNum = idx + 1;
  const isLast = idx === total - 1;

  const titleHtml = title
    ? `<div class="step-title" data-inline-field="${colKey}.${idx}.title" dir="auto">${esc(title)}</div>`
    : '';
  const textHtml = text
    ? `<div class="step-text" data-inline-field="${colKey}.${idx}.text" dir="auto">${esc(text)}</div>`
    : '';

  // Arrow between steps (not after the last one)
  const arrowHtml = !isLast
    ? `<div class="process-arrow" aria-hidden="true"></div>`
    : '';

  return `
    <div class="process-step" data-step="${stepNum}" role="listitem" data-inline-item="${colKey}" data-inline-item-index="${idx}">
      <div class="step-number" aria-hidden="true">${stepNum}</div>
      <div class="step-content">
        ${titleHtml}
        ${textHtml}
      </div>
    </div>
    ${arrowHtml}
  `;
}

export default {
  label: 'Process',
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
      key: 'direction',
      label: 'Direction',
      type: 'enum',
      required: false,
      options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ],
    },
    {
      key: 'items',
      label: 'Steps',
      type: 'items',
      required: true,
      minItems: 3,
      maxItems: 7,
      itemDefaults: {
        title: 'New step',
        text: '',
      },
      itemFields: [
        {
          key: 'title',
          label: 'Step title',
          type: 'string',
          required: true,
          maxLength: 60,
        },
        {
          key: 'text',
          label: 'Step description',
          type: 'string',
          required: false,
          maxLength: 200,
        },
      ],
    },
    // DEPRECATED: Remove after April 2026
    {
      key: 'steps',
      label: 'Steps (legacy)',
      type: 'items',
      required: false,
      hidden: true,
      minItems: 3,
      maxItems: 7,
      itemDefaults: {
        title: 'New step',
        text: '',
      },
      itemFields: [
        {
          key: 'title',
          label: 'Step title',
          type: 'string',
          required: true,
          maxLength: 60,
        },
        {
          key: 'text',
          label: 'Step description',
          type: 'string',
          required: false,
          maxLength: 200,
        },
      ],
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'Onze aanpak',
      subheading: '',
      bottomSubheading: '',
      direction: 'horizontal',
      items: [
        { title: 'Analyse', text: 'We onderzoeken de situatie' },
        { title: 'Ontwerp', text: 'We maken een plan' },
        { title: 'Uitvoering', text: 'We bouwen de oplossing' },
        { title: 'Evaluatie', text: 'We meten het resultaat' },
      ],
      background: 'mist',
    },
    'en-GB': {
      title: 'Our process',
      subheading: '',
      bottomSubheading: '',
      direction: 'horizontal',
      items: [
        { title: 'Analysis', text: 'We research the situation' },
        { title: 'Design', text: 'We create a plan' },
        { title: 'Execution', text: 'We build the solution' },
        { title: 'Evaluation', text: 'We measure the results' },
      ],
      background: 'mist',
    },
  },
  defaults: {
    title: 'Our process',
    subheading: '',
    bottomSubheading: '',
    direction: 'horizontal',
    items: [
      { title: 'Analysis', text: 'We research the situation' },
      { title: 'Design', text: 'We create a plan' },
      { title: 'Execution', text: 'We build the solution' },
      { title: 'Evaluation', text: 'We measure the results' },
    ],
    background: 'mist',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
        : '';
    const subheadingText = getSubheadingText(content);
    const subheadingHtml = subheadingText
      ? `<p class="subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(subheadingText)}</p>`
      : '';
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const hasHeader = !!(title || subheadingHtml);

    const direction = content?.direction === 'vertical' ? 'vertical' : 'horizontal';
    // DEPRECATED: 'steps' fallback - Remove after April 2026
    const steps = getCollectionItems(content, 'items', ['steps']).slice(0, 7);
    const colKey = getCollectionKey(content, 'items', ['steps']);
    const count = clampInt(steps.length, 3, 7, 4);

    // Determine layout mode: 5+ items get multi-row (horizontal) or multi-column (vertical)
    let layoutAttr = '';
    if (count >= 5) {
      layoutAttr = direction === 'horizontal' ? ' data-layout="multi-row"' : ' data-layout="multi-column"';
    }

    const stepsHtml = steps
      .slice(0, count)
      .map((step, idx) => stepHtml(step, idx, count, direction, colKey))
      .join('');

    return `
      <div class="slide slide-process ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <div class="process-container" data-direction="${direction}" data-count="${count}"${layoutAttr} role="list" aria-label="Process steps">
            ${stepsHtml}
          </div>
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};