import {
  bgClass,
  esc,
  renderSubheadingHtml,
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
  const text = typeof stage?.text === 'string' ? stage.text.trim() : '';
  const stageNum = idx + 1;

  const labelHtml = label
    ? `<div class="cycle-label" data-inline-field="${colKey}.${idx}.label" dir="auto">${esc(label)}</div>`
    : '';
  const textHtml = text
    ? `<div class="cycle-text" data-inline-field="${colKey}.${idx}.text" dir="auto">${esc(text)}</div>`
    : '';

  // Calculate position angle for circular arrangement
  const angleOffset = -90; // Start from top
  const angle = angleOffset + (idx / total) * 360;

  return `
    <li class="cycle-stage" data-stage="${stageNum}" style="--stage-angle: ${angle}deg; --stage-index: ${idx};" data-inline-item="${colKey}" data-inline-item-index="${idx}">
      <div class="stage-node">
        <div class="stage-number">${stageNum}</div>
      </div>
      <div class="stage-details">
        ${labelHtml}
        ${textHtml}
      </div>
    </li>
  `;
}

function arrowHtml(idx, total) {
  const angleOffset = -90;
  // Arrow sits between stages
  const angle = angleOffset + ((idx + 0.5) / total) * 360;

  return `
    <div class="cycle-arrow" style="--arrow-angle: ${angle}deg;" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z"/>
      </svg>
    </div>
  `;
}

export default {
  label: 'Cycle',
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
      key: 'centerLabel',
      label: 'Center label',
      type: 'string',
      required: false,
      maxLength: 60,
      placeholder: 'Optional center text',
    },
    {
      key: 'items',
      label: 'Stages',
      type: 'items',
      // Cycle stages run in sequence (Plan → Do → Check → Act). Projects to <ol>.
      ordered: true,
      required: true,
      minItems: 3,
      maxItems: 6,
      itemDefaults: {
        label: 'Stage',
        text: '',
      },
      itemFields: [
        {
          key: 'label',
          label: 'Stage label',
          type: 'string',
          required: true,
          maxLength: 40,
        },
        {
          key: 'text',
          label: 'Description',
          type: 'string',
          required: false,
          maxLength: 80,
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
        text: '',
      },
      itemFields: [
        {
          key: 'label',
          label: 'Stage label',
          type: 'string',
          required: true,
          maxLength: 40,
        },
        {
          key: 'text',
          label: 'Description',
          type: 'string',
          required: false,
          maxLength: 80,
        },
      ],
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'PDCA-cyclus',
      subheading: '',
      bottomSubheading: '',
      centerLabel: 'Continue verbetering',
      items: [
        { label: 'Plan', text: 'Analyseer en plan' },
        { label: 'Do', text: 'Voer uit' },
        { label: 'Check', text: 'Evalueer resultaten' },
        { label: 'Act', text: 'Verbeter en standaardiseer' },
      ],
      background: 'mist',
    },
    'en-GB': {
      title: 'PDCA cycle',
      subheading: '',
      bottomSubheading: '',
      centerLabel: 'Continuous improvement',
      items: [
        { label: 'Plan', text: 'Analyse and plan' },
        { label: 'Do', text: 'Execute' },
        { label: 'Check', text: 'Evaluate results' },
        { label: 'Act', text: 'Improve and standardise' },
      ],
      background: 'mist',
    },
  },
  defaults: {
    title: 'PDCA cycle',
    subheading: '',
    bottomSubheading: '',
    centerLabel: 'Continuous improvement',
    items: [
      { label: 'Plan', text: 'Analyse and plan' },
      { label: 'Do', text: 'Execute' },
      { label: 'Check', text: 'Evaluate results' },
      { label: 'Act', text: 'Improve and standardise' },
    ],
    background: 'mist',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
        : '';
    const subheadingHtml = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const bottomSubheadingHtml = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);
    const hasHeader = !!(title || subheadingHtml);

    const centerLabel = typeof content?.centerLabel === 'string' ? content.centerLabel.trim() : '';
    const centerHtml = centerLabel
      ? `<div class="cycle-center"><span class="center-label" data-inline-field="centerLabel" dir="auto">${esc(centerLabel)}</span></div>`
      : '<div class="cycle-center"></div>';

    // DEPRECATED: 'stages' fallback - Remove after April 2026
    const stages = getCollectionItems(content, 'items', ['stages']).slice(0, 6);
    const colKey = getCollectionKey(content, 'items', ['stages']);
    const count = clampInt(stages.length, 3, 6, 4);

    const stagesHtml = stages
      .slice(0, count)
      .map((stage, idx) => stageHtml(stage, idx, count, colKey))
      .join('');

    // Generate arrows between stages
    const arrowsHtml = Array.from({ length: count }, (_, idx) => arrowHtml(idx, count)).join('');

    return `
      <div class="slide slide-cycle ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <div class="cycle-container" data-count="${count}">
            <div class="cycle-ring">
              ${arrowsHtml}
              ${centerHtml}
            </div>
            <ol class="cycle-stages" aria-label="Cycle stages">
              ${stagesHtml}
            </ol>
          </div>
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};