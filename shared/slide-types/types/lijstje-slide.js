import { bgClass, esc, renderSubheadingHtml, BACKGROUND_FIELD } from '../helpers.js';

export default {
  label: 'List',
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
      maxLength: 160,
    },
    {
      key: 'variant',
      label: 'Style',
      type: 'enum',
      required: false,
      options: [
        { value: 'bullets', label: 'Bullets' },
        { value: 'numbers', label: 'Numbers' },
      ],
    },
    {
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      options: [
        { value: 'auto', label: 'Auto (fit)' },
        { value: 'one-column', label: 'One column' },
        { value: 'two-column', label: 'Two columns' },
      ],
    },
    {
      key: 'density',
      label: 'Text size',
      type: 'enum',
      required: false,
      // 'auto' keeps the default sizing; 'comfortable' scales titles and text
      // up to fill sparse slides (few items); 'compact' shrinks them so many
      // items still fit on one slide.
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'comfortable', label: 'Large' },
        { value: 'compact', label: 'Small' },
      ],
    },
    BACKGROUND_FIELD,
    {
      key: 'items',
      label: 'Items',
      type: 'items',
      required: true,
      minItems: 2,
      maxItems: 8,
      itemDefaults: { title: '', text: '' },
      itemFields: [
        {
          key: 'title',
          label: 'Title',
          type: 'string',
          required: true,
          maxLength: 80,
          // Sits in a flex row next to the bullet/number marker; block
          // alignment would detach the text from its marker. See text-roles.js.
          role: 'list-item',
        },
        {
          key: 'text',
          label: 'Text (single line)',
          type: 'string',
          required: false,
          maxLength: 120,
          role: 'list-item',
        },
      ],
    },
  ],
  defaultsByLang: {
    nl: {
      title: 'Lijstje',
      subheading: '',
      variant: 'bullets',
      layout: 'auto',
      density: 'auto',
      items: [
        {
          title: 'Eerste punt',
          text: 'Korte toelichting op één regel',
        },
        {
          title: 'Tweede punt',
          text: 'Nog een korte toelichting',
        },
        { title: 'Derde punt', text: 'Hou dit compact' },
      ],
      background: 'lime',
    },
    'en-GB': {
      title: 'List',
      subheading: '',
      variant: 'bullets',
      layout: 'auto',
      density: 'auto',
      items: [
        {
          title: 'First point',
          text: 'Short explanation in one line',
        },
        {
          title: 'Second point',
          text: 'Another short explanation',
        },
        { title: 'Third point', text: 'Keep this compact' },
      ],
      background: 'lime',
    },
  },
  // Back-compat fallback
  defaults: {
    title: 'List',
    subheading: '',
    variant: 'bullets',
    layout: 'auto',
    density: 'auto',
    items: [
      {
        title: 'First point',
        text: 'Short explanation in one line',
      },
      {
        title: 'Second point',
        text: 'Another short explanation',
      },
      { title: 'Third point', text: 'Keep this compact' },
    ],
    background: 'lime',
  },
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const variant =
      content?.variant === 'numbers'
        ? 'is-numbers'
        : 'is-bullets';
    // Layout: 'one-column' | 'two-column' | 'auto'. Auto switches to two
    // columns once there are enough items that one column would get cramped
    // (5+); this keeps the "6 bullets with longer text" case readable without
    // the presenter having to pick a layout. Unset/legacy stays one-column.
    const itemCount = Array.isArray(content?.items)
      ? content.items.length
      : 0;
    const layout =
      content?.layout === 'two-column' ||
      (content?.layout === 'auto' && itemCount >= 5)
        ? 'is-two-col'
        : 'is-one-col';
    // Text size: 'comfortable' (large) scales up titles + text to fill sparse
    // slides; 'compact' (small) shrinks them so many items still fit. 'auto'
    // (or unset/legacy) keeps the default sizing.
    const rawDensity = content?.density;
    const densityClass =
      rawDensity === 'comfortable'
        ? ' is-comfortable'
        : rawDensity === 'compact'
          ? ' is-compact'
          : '';
    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const items = Array.isArray(content?.items)
      ? content.items
      : [];

    const renderItem = (it, idx) => {
      const t =
        typeof it?.title === 'string'
          ? it.title.trim()
          : '';
      // Force single-line text (also enforced visually via CSS).
      const x =
        typeof it?.text === 'string'
          ? it.text.replace(/\s*\n+\s*/g, ' ').trim()
          : '';
      const marker =
        variant === 'is-numbers'
          ? `<div class="marker" aria-hidden="true">${idx + 1}</div>`
          : `<div class="marker" aria-hidden="true"></div>`;
      // Omit the text element when empty so the inline editor can offer an
      // "+ Text" ghost affordance (see itemGhosts in descriptors.js) instead of
      // leaving an unclickable empty div. The renderer still emits it when the
      // ghost-spawn sentinel (zero-width space) is present, so editing works.
      const textHtml = x
        ? `<div class="item-text" data-inline-field="items.${idx}.text" dir="auto">${esc(x)}</div>`
        : '';
      return `
        <li class="lijst-item" data-inline-item="items" data-inline-item-index="${idx}">
          ${marker}
          <div class="lijst-item-body">
            <div class="item-title" data-inline-field="items.${idx}.title" dir="auto">${esc(t)}</div>
            ${textHtml}
          </div>
        </li>
      `;
    };

    // Native list semantics: numbered variant → <ol>, bullets → <ul>.
    const listTag = variant === 'is-numbers' ? 'ol' : 'ul';
    // Two-column: fill left column first, then right column. Each column is its
    // own native list so <li>s always sit directly inside a <ul>/<ol>.
    const isTwoCol = layout === 'is-two-col';
    let listHtml;
    if (isTwoCol && items.length > 1) {
      const midpoint = Math.ceil(items.length / 2);
      const leftItems = items.slice(0, midpoint);
      const rightItems = items.slice(midpoint);
      const leftHtml = leftItems.map((it, i) => renderItem(it, i)).join('');
      const rightHtml = rightItems.map((it, i) => renderItem(it, midpoint + i)).join('');
      listHtml = `
        <div class="lijst">
          <${listTag} class="lijst-col">${leftHtml}</${listTag}>
          <${listTag} class="lijst-col">${rightHtml}</${listTag}>
        </div>
      `;
    } else {
      const itemsHtml = items.map((it, idx) => renderItem(it, idx)).join('');
      listHtml = `<${listTag} class="lijst">${itemsHtml}</${listTag}>`;
    }

    return `
      <div class="slide slide-lijstje ${variant} ${layout}${densityClass} ${bg}">
        <div class="slide-inner">
          <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
          ${subheading}
          ${listHtml}
        </div>
      </div>
    `;
  },
};