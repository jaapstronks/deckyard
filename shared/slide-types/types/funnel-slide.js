import {
  bgClass,
  escapeHtml,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
  clampInt,
  getCollectionItems,
} from '../helpers.js';

function stageHtml(stage, idx, total) {
  const label = typeof stage?.label === 'string' ? stage.label.trim() : '';
  const value = typeof stage?.value === 'string' ? stage.value.trim() : '';
  const text = typeof stage?.text === 'string' ? stage.text.trim() : '';
  const stageNum = idx + 1;

  const labelHtml = label
    ? `<div class="stage-label" data-inline-field="items.${idx}.label" dir="auto">${escapeHtml(label)}</div>`
    : '';
  const valueHtml = value
    ? `<div class="stage-value" data-inline-field="items.${idx}.value" dir="auto">${escapeHtml(value)}</div>`
    : '';
  const textHtml = text
    ? `<div class="stage-text" data-inline-field="items.${idx}.text" dir="auto">${escapeHtml(text)}</div>`
    : '';

  // Calculate width percentage for funnel effect (narrowing from top to bottom)
  const widthPercent = 100 - (idx / Math.max(total - 1, 1)) * 40;

  return `
    <li class="funnel-stage" data-stage="${stageNum}" style="--stage-width: ${widthPercent}%;" data-inline-item="items" data-inline-item-index="${idx}">
      <div class="stage-bar on-surface-lime">
        <div class="stage-content">
          ${labelHtml}
          ${valueHtml}
        </div>
      </div>
      ${textHtml}
    </li>
  `;
}

export default {
  structure: 'collection',
  fallback: 'list-slide',
  runtime: 'static',
  label: 'Funnel',
  fields: [
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      labelKey: 'editor.slideField.subheading.label',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      labelKey: 'editor.slideField.bottomSubheading.label',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'items',
      label: 'Stages',
      labelKey: 'editor.slideField.stages.label',
      type: 'items',
      // Funnel stages are an ordered progression (top to bottom). Projects to <ol>.
      ordered: true,
      required: true,
      minItems: 3,
      maxItems: 6,
      itemDefaults: {
        label: 'Stage',
        value: '',
        text: '',
      },
      itemDefaultsByLang: {
        nl: {
          label: 'Fase',
          value: '',
          text: '',
        },
      },
      itemFields: [
        {
          key: 'label',
          label: 'Stage label',
          labelKey: 'editor.slideField.stageLabel.label',
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
          labelKey: 'editor.slideField.description.label',
          type: 'string',
          required: false,
          maxLength: 120,
          // `.slide-funnel .stage-text` is centred (90-funnel-slide.css).
          defaultAlign: 'center',
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
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
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
        ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(content.title.trim())}</h2>`
        : '';
    const subheadingHtml = renderSubheadingHtml(
      content,
      'subheading',
      'subtitle',
    );
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const hasHeader = !!(title || subheadingHtml);

    const stages = getCollectionItems(content, 'items').slice(0, 6);
    const count = clampInt(stages.length, 3, 6, 4);

    const stagesHtml = stages
      .slice(0, count)
      .map((stage, idx) => stageHtml(stage, idx, count))
      .join('');

    return `
      <div class="slide slide-funnel ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <ol class="funnel-container" data-count="${count}" aria-label="Funnel stages">
            ${stagesHtml}
          </ol>
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};
