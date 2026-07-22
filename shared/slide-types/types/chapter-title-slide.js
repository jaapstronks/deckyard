import {
  esc,
  gradientVarsForSlide,
  styleAttrFromVars,
} from '../helpers.js';

const LAYOUTS = ['top', 'center', 'bottom'];

export default {
  label: 'Section title',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 140,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 160,
    },
    {
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      // Note: values are persisted in decks; keep them stable.
      options: [
        {
          value: 'top',
          label: 'Top',
          title: 'Title at the top of the slide.',
          ariaLabel: 'Title at top',
        },
        {
          value: 'center',
          label: 'Center',
          title: 'Title vertically centered (default).',
          ariaLabel: 'Title centered',
        },
        {
          value: 'bottom',
          label: 'Bottom',
          title: 'Title at the bottom of the slide.',
          ariaLabel: 'Title at bottom',
        },
      ],
    },
  ],
  defaultsByLang: {
    nl: { title: 'Sectietitel', subheading: '', layout: 'center' },
    'en-GB': { title: 'Chapter title', subheading: '', layout: 'center' },
  },
  // Back-compat fallback
  defaults: { title: 'Chapter title', subheading: '', layout: 'center' },
  renderHtml: (content, slide) => {
    const vars = gradientVarsForSlide(slide?.id, 'chapter');
    const layout = LAYOUTS.includes(content?.layout)
      ? content.layout
      : 'center';
    const subtitle =
      typeof content?.subheading === 'string' && content.subheading.trim()
        ? `<p class="subtitle" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(content.subheading)}</p>`
        : '';
    return `
        <div class="slide slide-chapter-title is-layout-${layout}"${styleAttrFromVars(vars)}>
          <div class="slide-inner">
            <h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
            ${subtitle}
          </div>
        </div>
      `;
  },
};
