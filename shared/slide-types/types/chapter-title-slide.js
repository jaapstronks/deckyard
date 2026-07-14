import {
  esc,
  gradientVarsForSlide,
  styleAttrFromVars,
} from '../helpers.js';

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
  ],
  defaultsByLang: {
    nl: { title: 'Sectietitel' },
    'en-GB': { title: 'Chapter title' },
  },
  // Back-compat fallback
  defaults: { title: 'Chapter title' },
  renderHtml: (content, slide) => {
    const vars = gradientVarsForSlide(slide?.id, 'chapter');
    return `
        <div class="slide slide-chapter-title"${styleAttrFromVars(vars)}>
          <div class="slide-inner">
            <h1 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h1>
          </div>
        </div>
      `;
  },
};
