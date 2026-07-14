import { bgClass, esc, BACKGROUND_FIELD } from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';
import { ACTIONS_FIELD, renderActionsHtml } from '../actions-field.js';

export default {
  label: 'Text slide',
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
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      options: ['two-column', 'one-column'],
    },
    {
      key: 'density',
      label: 'Text size',
      type: 'enum',
      required: false,
      // 'auto' shrinks to the compact size only when the body overflows;
      // 'comfortable' forces the larger size; 'compact' forces the smaller size.
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'comfortable', label: 'Large' },
        { value: 'compact', label: 'Small' },
      ],
    },
    {
      key: 'body',
      label: 'Body (Markdown)',
      type: 'markdown',
      required: true,
      maxLength: 3000,
    },
    BACKGROUND_FIELD,
    ACTIONS_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'Nieuwe slide',
      subheading: '',
      // Default to a simple, readable layout. The AI wizard (and users) can opt into
      // two-column for dense content.
      layout: 'one-column',
      density: 'auto',
      body: '- Eerste punt\n- Tweede punt',
      background: 'lime',
      actions: [],
    },
    'en-GB': {
      title: 'New slide',
      subheading: '',
      // Default to a simple, readable layout. The AI wizard (and users) can opt into
      // two-column for dense content.
      layout: 'one-column',
      density: 'auto',
      body: '- First point\n- Second point',
      background: 'lime',
      actions: [],
    },
  },
  // Back-compat fallback
  defaults: {
    title: 'New slide',
    subheading: '',
    // Default to a simple, readable layout. The AI wizard (and users) can opt into
    // two-column for dense content.
    layout: 'one-column',
    density: 'auto',
    body: '- First point\n- Second point',
    background: 'lime',
    actions: [],
  },
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const layout =
      content?.layout === 'one-column' ? 'is-one-col' : 'is-two-col';
    const rawDensity = content?.density;
    const density =
      rawDensity === 'comfortable' || rawDensity === 'compact'
        ? rawDensity
        : 'auto';
    // 'compact' forces the small size up front. 'auto' starts comfortable
    // and the runtime adds is-compact if the body overflows.
    const densityClass = density === 'compact' ? ' is-compact' : '';
    const subheading =
      typeof content?.subheading === 'string' && content.subheading.trim()
        ? `<p class="subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(content.subheading.trim())}</p>`
        : '';
    const actionsHtml = renderActionsHtml(content?.actions);
    return `
        <div class="slide slide-content ${layout}${densityClass} ${bg}" data-density="${density}">
          <div class="slide-inner">
            <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
            ${subheading}
            <div class="body" data-morph-role="body" data-inline-field="body" data-inline-kind="markdown">${markdownToSafeHtml(content?.body || '')}</div>
            ${actionsHtml}
          </div>
        </div>
      `;
  },
};
