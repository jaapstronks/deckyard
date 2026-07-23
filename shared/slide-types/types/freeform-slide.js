import {
  esc,
  clampInt,
  pickAltText,
  objectPositionStyleAttrFromFocus,
  imagePlaceholderHtml,
} from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

// Extended background options for freeform slide
const FREEFORM_BG_OPTIONS = [
  { value: 'lime', label: 'Lime' },
  { value: 'mist', label: 'Mist' },
  { value: 'dark', label: 'Dark' },
  { value: 'accent', label: 'Accent' },
  { value: 'brand-1', label: 'Brand 1' },
  { value: 'brand-2', label: 'Brand 2' },
  { value: 'custom', label: 'Custom color' },
];

// Font size presets mapping to CSS classes
const FONT_SIZE_MAP = {
  sm: 'freeform-text-sm',
  md: 'freeform-text-md',
  lg: 'freeform-text-lg',
  xl: 'freeform-text-xl',
};

function freeformBgClass(bg, customColor) {
  const v = String(bg || 'lime');
  if (v === 'custom' && customColor) {
    // Custom color handled via inline style in render
    return 'slide-bg-custom';
  }
  if (v === 'mist') return 'slide-bg-mist';
  if (v === 'dark') return 'slide-bg-dark';
  if (v === 'accent') return 'slide-bg-accent';
  if (v === 'brand-1') return 'slide-bg-brand-1';
  if (v === 'brand-2') return 'slide-bg-brand-2';
  return 'slide-bg-lime';
}

function renderElement(el, idx) {
  if (!el || typeof el !== 'object') return '';

  const type = String(el.type || 'text');
  const x = clampInt(el.x, 0, 100, 10);
  const y = clampInt(el.y, 0, 100, 10);
  const width = clampInt(el.width, 5, 100, 30);
  const height = clampInt(el.height, 5, 100, 20);
  const zIndex = clampInt(el.zIndex, 0, 100, idx);
  const fontSize = FONT_SIZE_MAP[el.fontSize] || 'freeform-text-md';

  const baseStyle = `position:absolute; left:${x}%; top:${y}%; width:${width}%; z-index:${zIndex};`;
  const id = el.id || `el-${idx}`;

  if (type === 'heading') {
    const content = String(el.content || '').trim();
    return `
      <div class="freeform-element freeform-element--heading ${fontSize}"
           data-element-id="${esc(id)}"
           data-element-type="heading"
           style="${baseStyle}">
        <span dir="auto">${esc(content)}</span>
      </div>
    `;
  }

  if (type === 'text') {
    const content = String(el.content || '').trim();
    return `
      <div class="freeform-element freeform-element--text ${fontSize}"
           data-element-id="${esc(id)}"
           data-element-type="text"
           style="${baseStyle}">
        <div class="freeform-text-content" dir="auto">${markdownToSafeHtml(content)}</div>
      </div>
    `;
  }

  if (type === 'image') {
    const src = String(el.src || '').trim();
    const altExplicit = String(el.alt || '').trim();
    const alt = pickAltText({
      explicit: altExplicit,
      src,
      hardFallback: `Image ${idx + 1}`,
    });
    const focusStyle = objectPositionStyleAttrFromFocus({
      focusX: el.focusX,
      focusY: el.focusY,
    });
    const heightStyle = `height:${height}%;`;

    if (!src) {
      return `
        <div class="freeform-element freeform-element--image is-placeholder"
             data-element-id="${esc(id)}"
             data-element-type="image"
             style="${baseStyle} ${heightStyle}">
          ${imagePlaceholderHtml({ className: 'freeform-image-placeholder', compact: true })}
        </div>
      `;
    }

    return `
      <div class="freeform-element freeform-element--image"
           data-element-id="${esc(id)}"
           data-element-type="image"
           style="${baseStyle} ${heightStyle}">
        <img src="${esc(src)}" alt="${esc(alt)}"${focusStyle ? ` ${focusStyle}` : ''} />
      </div>
    `;
  }

  return '';
}

export default {
  label: 'Freeform',
  // Archived: the freeform canvas (absolutely-positioned elements) was retired
  // as an authoring surface — too easy to make ugly/inaccessible slides, and it
  // never gained a semantic projection (it degrades to nothing in the reader /
  // reflow view). Kept registered, render-only, so decks that already contain a
  // freeform slide keep rendering exactly as before. `deprecated: true` removes
  // it from the type picker (isInsertableSlideType / allowed() return false) and
  // it is listed in the AI generator's EXCLUDED_TYPES, so no new freeform slides
  // can be authored. Mirrors the split-partner-title archival (PR #197).
  deprecated: true,
  fields: [
    {
      key: 'elements',
      label: 'Elements',
      type: 'items',
      required: false,
      minItems: 0,
      maxItems: 20,
      itemDefaults: {
        id: '',
        type: 'text',
        x: 10,
        y: 10,
        width: 30,
        height: 20,
        zIndex: 0,
        content: '',
        src: '',
        alt: '',
        focusX: 50,
        focusY: 50,
        fontSize: 'md',
      },
      itemFields: [
        { key: 'id', label: 'ID', type: 'string', hidden: true },
        {
          key: 'type',
          label: 'Type',
          type: 'enum',
          options: ['heading', 'text', 'image'],
        },
        { key: 'x', label: 'X position (%)', type: 'number', min: 0, max: 100 },
        { key: 'y', label: 'Y position (%)', type: 'number', min: 0, max: 100 },
        { key: 'width', label: 'Width (%)', type: 'number', min: 5, max: 100 },
        { key: 'height', label: 'Height (%)', type: 'number', min: 5, max: 100 },
        { key: 'zIndex', label: 'Layer', type: 'number', min: 0, max: 100 },
        { key: 'content', label: 'Content', type: 'markdown', maxLength: 2000 },
        { key: 'src', label: 'Image', type: 'image' },
        { key: 'alt', label: 'Alt text', type: 'string', maxLength: 200 },
        { key: 'focusX', label: 'Focus X', type: 'number', min: 0, max: 100 },
        { key: 'focusY', label: 'Focus Y', type: 'number', min: 0, max: 100 },
        {
          key: 'fontSize',
          label: 'Font size',
          type: 'enum',
          options: [
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
            { value: 'xl', label: 'Extra large' },
          ],
        },
      ],
    },
    {
      key: 'background',
      label: 'Background',
      type: 'enum',
      required: false,
      options: FREEFORM_BG_OPTIONS,
    },
    {
      key: 'bgCustomColor',
      label: 'Custom background color',
      type: 'color',
      required: false,
      helpText: 'Only used when background is set to "Custom color".',
    },
    {
      key: 'snapToGrid',
      label: 'Snap to grid',
      type: 'enum',
      required: false,
      options: [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ],
    },
  ],
  defaultsByLang: {
    nl: {
      elements: [
        {
          id: 'default-heading-1',
          type: 'heading',
          x: 10,
          y: 15,
          width: 80,
          height: 15,
          zIndex: 1,
          content: 'Freeform slide',
          fontSize: 'xl',
        },
        {
          id: 'default-text-1',
          type: 'text',
          x: 10,
          y: 35,
          width: 40,
          height: 50,
          zIndex: 0,
          content: 'Plaats elementen vrij op het canvas.\n\n- Sleep om te verplaatsen\n- Versleep hoeken om grootte aan te passen\n- Gebruik laagknoppen voor volgorde',
          fontSize: 'md',
        },
      ],
      background: 'lime',
      bgCustomColor: '',
      snapToGrid: 'on',
    },
    'en-GB': {
      elements: [
        {
          id: 'default-heading-1',
          type: 'heading',
          x: 10,
          y: 15,
          width: 80,
          height: 15,
          zIndex: 1,
          content: 'Freeform slide',
          fontSize: 'xl',
        },
        {
          id: 'default-text-1',
          type: 'text',
          x: 10,
          y: 35,
          width: 40,
          height: 50,
          zIndex: 0,
          content: 'Position elements freely on the canvas.\n\n- Drag to move\n- Drag corners to resize\n- Use layer buttons to reorder',
          fontSize: 'md',
        },
      ],
      background: 'lime',
      bgCustomColor: '',
      snapToGrid: 'on',
    },
  },
  defaults: {
    elements: [
      {
        id: 'default-heading-1',
        type: 'heading',
        x: 10,
        y: 15,
        width: 80,
        height: 15,
        zIndex: 1,
        content: 'Freeform slide',
        fontSize: 'xl',
      },
      {
        id: 'default-text-1',
        type: 'text',
        x: 10,
        y: 35,
        width: 40,
        height: 50,
        zIndex: 0,
        content: 'Position elements freely on the canvas.\n\n- Drag to move\n- Drag corners to resize\n- Use layer buttons to reorder',
        fontSize: 'md',
      },
    ],
    background: 'lime',
    bgCustomColor: '',
    snapToGrid: 'on',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = content?.background || 'lime';
    const customColor = String(content?.bgCustomColor || '').trim();
    const bgClassName = freeformBgClass(bg, customColor);

    // Custom color inline style
    const customStyle = bg === 'custom' && customColor
      ? ` style="--freeform-custom-bg: ${esc(customColor)};"`
      : '';

    // Get elements and sort by zIndex for proper layering
    const elements = Array.isArray(content?.elements) ? content.elements : [];
    const sortedElements = [...elements].sort((a, b) => {
      const zA = clampInt(a?.zIndex, 0, 100, 0);
      const zB = clampInt(b?.zIndex, 0, 100, 0);
      return zA - zB;
    });

    const elementsHtml = sortedElements
      .map((el, idx) => renderElement(el, idx))
      .join('');

    return `
      <div class="slide slide-freeform ${bgClassName}"${customStyle}>
        <div class="freeform-canvas">
          ${elementsHtml}
        </div>
      </div>
    `;
  },
};
