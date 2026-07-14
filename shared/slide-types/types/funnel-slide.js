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

function safeStagesArr(stages) {
  return Array.isArray(stages) ? stages : [];
}

function stageHtml(stage, idx, total, colKey = 'items') {
  const label = typeof stage?.label === 'string' ? stage.label.trim() : '';
  const value = typeof stage?.value === 'string' ? stage.value.trim() : '';
  const text = typeof stage?.text === 'string' ? stage.text.trim() : '';
  const stageNum = idx + 1;

  const labelHtml = label
    ? `<div class="stage-label" data-inline-field="${colKey}.${idx}.label" dir="auto">${esc(label)}</div>`
    : '';
  const valueHtml = value
    ? `<div class="stage-value" data-inline-field="${colKey}.${idx}.value" dir="auto">${esc(value)}</div>`
    : '';
  const textHtml = text
    ? `<div class="stage-text" data-inline-field="${colKey}.${idx}.text" dir="auto">${esc(text)}</div>`
    : '';

  // Calculate width percentage for funnel effect (narrowing from top to bottom)
  const widthPercent = 100 - (idx / Math.max(total - 1, 1)) * 40;

  return `
    <div class="funnel-stage" data-stage="${stageNum}" style="--stage-width: ${widthPercent}%;" role="listitem" data-inline-item="${colKey}" data-inline-item-index="${idx}">
      <div class="stage-bar">
        <div class="stage-content">
          ${labelHtml}
          ${valueHtml}
        </div>
      </div>
      ${textHtml}
    </div>
  `;
}

export default {
  label: 'Funnel',
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
      key: 'items',
      label: 'Stages',
      type: 'items',
      required: true,
      minItems: 3,
      maxItems: 6,
      itemDefaults: {
        label: 'Stage',
        value: '',
        text: '',
      },
      itemFields: [
        {
          key: 'label',
          label: 'Stage label',
          type: 'string',
          required: true,
          maxLength: 60,
        },
        {
          key: 'value',
          label: 'Value/metric',
          type: 'string',
          required: false,
          maxLength: 30,
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
    // DEPRECATED: Remove after April 2026
    {
      key: 'stages',
      label: 'Stages (legacy)',
      type: 'items',
      required: false,
      hidden: true,
      minItems: 3,
      maxItems: 6,
      itemDefaults: {
        label: 'Stage',
        value: '',
        text: '',
      },
      itemFields: [
        {
          key: 'label',
          label: 'Stage label',
          type: 'string',
          required: true,
          maxLength: 60,
        },
        {
          key: 'value',
          label: 'Value/metric',
          type: 'string',
          required: false,
          maxLength: 30,
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
      title: 'Conversie funnel',
      subheading: '',
      bottomSubheading: '',
      items: [
        { label: 'Bezoekers', value: '10.000', text: 'Website verkeer' },
        { label: 'Leads', value: '2.500', text: '25% conversie' },
        { label: 'Opportunities', value: '500', text: '20% kwalificatie' },
        { label: 'Klanten', value: '100', text: '20% closing rate' },
      ],
      background: 'mist',
    },
    'en-GB': {
      title: 'Conversion funnel',
      subheading: '',
      bottomSubheading: '',
      items: [
        { label: 'Visitors', value: '10,000', text: 'Website traffic' },
        { label: 'Leads', value: '2,500', text: '25% conversion' },
        { label: 'Opportunities', value: '500', text: '20% qualification' },
        { label: 'Customers', value: '100', text: '20% close rate' },
      ],
      background: 'mist',
    },
  },
  defaults: {
    title: 'Conversion funnel',
    subheading: '',
    bottomSubheading: '',
    items: [
      { label: 'Visitors', value: '10,000', text: 'Website traffic' },
      { label: 'Leads', value: '2,500', text: '25% conversion' },
      { label: 'Opportunities', value: '500', text: '20% qualification' },
      { label: 'Customers', value: '100', text: '20% close rate' },
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

    // DEPRECATED: 'stages' fallback - Remove after April 2026
    const stages = getCollectionItems(content, 'items', ['stages']).slice(0, 6);
    const colKey = getCollectionKey(content, 'items', ['stages']);
    const count = clampInt(stages.length, 3, 6, 4);

    const stagesHtml = stages
      .slice(0, count)
      .map((stage, idx) => stageHtml(stage, idx, count, colKey))
      .join('');

    return `
      <div class="slide slide-funnel ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <div class="funnel-container" data-count="${count}" role="list" aria-label="Funnel stages">
            ${stagesHtml}
          </div>
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};