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
  const text = typeof stage?.text === 'string' ? stage.text.trim() : '';
  const stageNum = idx + 1;

  const labelHtml = label
    ? `<div class="cycle-label" data-inline-field="items.${idx}.label" dir="auto">${escapeHtml(label)}</div>`
    : '';
  const textHtml = text
    ? `<div class="cycle-text" data-inline-field="items.${idx}.text" dir="auto">${escapeHtml(text)}</div>`
    : '';

  // Calculate position angle for circular arrangement
  const angleOffset = -90; // Start from top
  const angle = angleOffset + (idx / total) * 360;

  return `
    <li class="cycle-stage" data-stage="${stageNum}" style="--stage-angle: ${angle}deg; --stage-index: ${idx};" data-inline-item="items" data-inline-item-index="${idx}">
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
  structure: 'collection',
  fallback: 'list-slide',
  runtime: 'static',
  label: 'Cycle',
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
      labelKey: 'editor.slideField.stages.label',
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
      itemDefaultsByLang: {
        nl: {
          label: 'Fase',
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
          maxLength: 40,
        },
        {
          key: 'text',
          label: 'Description',
          labelKey: 'editor.slideField.description.label',
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
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
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

    const centerLabel =
      typeof content?.centerLabel === 'string'
        ? content.centerLabel.trim()
        : '';
    const centerHtml = centerLabel
      ? `<div class="cycle-center on-surface-mist"><span class="center-label" data-inline-field="centerLabel" dir="auto">${escapeHtml(centerLabel)}</span></div>`
      : '<div class="cycle-center on-surface-mist"></div>';

    const stages = getCollectionItems(content, 'items').slice(0, 6);
    const count = clampInt(stages.length, 3, 6, 4);

    const stagesHtml = stages
      .slice(0, count)
      .map((stage, idx) => stageHtml(stage, idx, count))
      .join('');

    // Generate arrows between stages
    const arrowsHtml = Array.from({ length: count }, (_, idx) =>
      arrowHtml(idx, count),
    ).join('');

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
