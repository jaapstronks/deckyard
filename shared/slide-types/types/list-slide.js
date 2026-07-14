import { bgClass, esc, getSubheadingText, BACKGROUND_FIELD } from '../helpers.js';

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
        },
        {
          key: 'text',
          label: 'Text (single line)',
          type: 'string',
          required: false,
          maxLength: 120,
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
    const itemCount = Array.isArray(content?.items)
      ? content.items.length
      : 0;
    // Text size: 'comfortable' (large) scales up titles + text to fill sparse
    // slides; 'compact' (small) shrinks them so many items still fit. A long
    // list can't render "large" without spilling even across two columns, so
    // drop large -> normal past 6 items.
    //
    // 'auto' (or unset/legacy) now *prefers* large: most lists — AI-generated
    // ones in particular — are a handful of short bullets that read undersized
    // at the default sizing. Only lists with many items or real sentences per
    // bullet keep the default fit.
    let effDensity = content?.density;
    const longestItem = (Array.isArray(content?.items) ? content.items : []).reduce(
      (mx, it) =>
        Math.max(
          mx,
          String(it?.title || '').trim().length + String(it?.text || '').trim().length
        ),
      0
    );
    if (
      (effDensity == null || effDensity === '' || effDensity === 'auto') &&
      itemCount > 0 &&
      itemCount <= 6 &&
      longestItem <= 90
    ) {
      effDensity = 'comfortable';
    }
    if (effDensity === 'comfortable' && itemCount > 6) effDensity = 'auto';
    const densityClass =
      effDensity === 'comfortable'
        ? ' is-comfortable'
        : effDensity === 'compact'
          ? ' is-compact'
          : '';
    // Layout: 'one-column' | 'two-column' | 'auto'. Honor an explicit
    // 'two-column'; otherwise ('auto', 'one-column', or unset/legacy) use one
    // column while the items fit, and fall back to two columns (which ~doubles
    // capacity) once there are more items than one column can hold at this text
    // size. The per-size caps are tuned so text never spills off the 720-tall
    // slide, even with the widest 2-line items and a subheading present. This
    // makes overflow impossible without overriding a deliberate 'two-column'.
    const oneColCap =
      effDensity === 'comfortable' ? 3 : effDensity === 'compact' ? 5 : 4;
    const layout =
      content?.layout === 'two-column' || itemCount > oneColCap
        ? 'is-two-col'
        : 'is-one-col';
    const subheadingText = getSubheadingText(content);
    const subheading = subheadingText
      ? `<p class="subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(subheadingText)}</p>`
      : '';
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
        <div class="lijst-item" role="listitem" data-inline-item="items" data-inline-item-index="${idx}">
          ${marker}
          <div class="lijst-item-body">
            <div class="item-title" data-inline-field="items.${idx}.title" dir="auto">${esc(t)}</div>
            ${textHtml}
          </div>
        </div>
      `;
    };

    // Two-column: fill left column first, then right column
    const isTwoCol = layout === 'is-two-col';
    let listContent;
    if (isTwoCol && items.length > 1) {
      const midpoint = Math.ceil(items.length / 2);
      const leftItems = items.slice(0, midpoint);
      const rightItems = items.slice(midpoint);
      const leftHtml = leftItems.map((it, i) => renderItem(it, i)).join('');
      const rightHtml = rightItems.map((it, i) => renderItem(it, midpoint + i)).join('');
      listContent = `
        <div class="lijst-col">${leftHtml}</div>
        <div class="lijst-col">${rightHtml}</div>
      `;
    } else {
      listContent = items.map((it, idx) => renderItem(it, idx)).join('');
    }

    return `
      <div class="slide slide-lijstje ${variant} ${layout}${densityClass} ${bg}">
        <div class="slide-inner">
          <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content?.title)}</h2>
          ${subheading}
          <div class="lijst" role="list">
            ${listContent}
          </div>
        </div>
      </div>
    `;
  },
};