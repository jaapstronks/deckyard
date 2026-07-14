import {
  bgClass,
  esc,
  objectPositionStyleAttrFromFocus,
  pickAltText,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';
import { ACTIONS_FIELD, renderActionsHtml } from '../actions-field.js';

export default {
  label: 'Image + text',
  fields: [
    {
      key: 'image',
      label: 'Image',
      type: 'image',
      // Allow creating a new image+text slide without selecting an image yet.
      // Rendering/export already handle missing images gracefully.
      required: false,
    },
    {
      key: 'caption',
      label: 'Caption',
      type: 'string',
      required: false,
      maxLength: 160,
    },
    {
      key: 'alt',
      label: 'Alt text',
      type: 'string',
      required: false,
      maxLength: 180,
    },
    {
      key: 'imageRole',
      label: 'Image role',
      type: 'enum',
      required: false,
      options: [
        {
          value: 'content',
          label: 'Meaningful (needs alt text)',
          title: 'This image conveys information and should have alt text.',
          ariaLabel: 'Meaningful image',
        },
        {
          value: 'decorative',
          label: 'Decorative (no alt)',
          title: 'This image is decorative; it will be hidden from screen readers.',
          ariaLabel: 'Decorative image',
        },
      ],
    },
    {
      key: 'imageSide',
      label: 'Image position',
      type: 'enum',
      required: false,
      options: ['left', 'right'],
    },
    {
      key: 'imageWidth',
      label: 'Image width',
      type: 'enum',
      required: false,
      options: [
        { value: 'half', label: '50%' },
        { value: 'narrow', label: '37%' },
      ],
    },
    {
      key: 'imageFit',
      label: 'Image fit',
      type: 'enum',
      required: false,
      options: ['cover', 'contain'],
    },
    {
      key: 'imageBackground',
      label: 'Image background',
      type: 'enum',
      required: false,
      options: [
        { value: 'white', label: 'White' },
        { value: 'match', label: 'Match slide' },
      ],
    },
    {
      key: 'focusX',
      label: 'Focus X',
      type: 'number',
      required: false,
      min: 0,
      max: 100,
      step: 1,
      helpText:
        'Only used when Image fit is “cover” (cropped). 0 = left, 50 = center, 100 = right.',
    },
    {
      key: 'focusY',
      label: 'Focus Y',
      type: 'number',
      required: false,
      min: 0,
      max: 100,
      step: 1,
      helpText:
        'Only used when Image fit is “cover” (cropped). 0 = top, 50 = center, 100 = bottom.',
    },
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'body',
      label: 'Body (Markdown)',
      type: 'markdown',
      required: true,
      maxLength: 3000,
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
    BACKGROUND_FIELD,
    ACTIONS_FIELD,
  ],
  defaultsByLang: {
    nl: {
      image: '',
      caption: '',
      alt: '',
      imageRole: 'content',
      imageSide: 'left',
      imageWidth: 'half',
      imageFit: 'cover',
      imageBackground: 'white',
      focusX: '',
      focusY: '',
      title: 'Nieuwe slide (split)',
      body: '- Punt één\n- Punt twee',
      background: 'lime',
      actions: [],
    },
    'en-GB': {
      image: '',
      caption: '',
      alt: '',
      imageRole: 'content',
      imageSide: 'left',
      imageWidth: 'half',
      imageFit: 'cover',
      imageBackground: 'white',
      focusX: '',
      focusY: '',
      title: 'New split slide',
      body: '- Point one\n- Point two',
      background: 'lime',
      actions: [],
    },
  },
  // Back-compat fallback
  defaults: {
    image: '',
    caption: '',
    alt: '',
    imageRole: 'content',
    imageSide: 'left',
    imageWidth: 'half',
    imageFit: 'cover',
    imageBackground: 'white',
    density: 'auto',
    focusX: '',
    focusY: '',
    title: 'New split slide',
    body: '- Point one\n- Point two',
    background: 'lime',
    actions: [],
  },
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const side =
      content?.imageSide === 'right'
        ? 'is-right'
        : 'is-left';
    const width =
      content?.imageWidth === 'narrow'
        ? 'is-image-narrow'
        : '';
    const fit =
      content?.imageFit === 'contain'
        ? 'is-image-contain'
        : 'is-image-cover';
    const imgBg =
      content?.imageBackground === 'match'
        ? 'is-image-bg-match'
        : '';
    const rawDensity = content?.density;
    const density =
      rawDensity === 'comfortable' || rawDensity === 'compact'
        ? rawDensity
        : 'auto';
    // 'compact' forces the small size up front. 'auto' starts comfortable
    // and the runtime adds is-compact if the body overflows.
    const densityClass = density === 'compact' ? ' is-compact' : '';
    const altNl =
      typeof content?.altNl === 'string' ? content.altNl.trim() : '';
    const altEn =
      typeof content?.altEn === 'string' ? content.altEn.trim() : '';
    const altExplicit =
      typeof content?.alt === 'string' ? content.alt.trim() : '';
    const caption = content?.caption
      ? `<figcaption class="caption" data-inline-field="caption" dir="auto">${esc(
          content.caption
        )}</figcaption>`
      : '';
    const imageRole =
      content?.imageRole === 'decorative' ? 'decorative' : 'content';
    const alt =
      imageRole === 'decorative'
        ? ''
        : pickAltText({
            explicit: altExplicit || altNl || altEn,
            src: content?.image,
            fallbacks: [content?.caption, content?.title],
            hardFallback: 'Image',
          });
    // For cover this controls crop focus; for contain this controls alignment.
    const focusStyle = objectPositionStyleAttrFromFocus(content);
    const img = content?.image
      ? (() => {
          const ariaDecorative =
            imageRole === 'decorative' ? ' aria-hidden="true"' : '';
          return `<img src="${esc(content.image)}" alt="${esc(
            alt
          )}"${ariaDecorative}${focusStyle} />`;
        })()
      : `<div class="image-placeholder" aria-hidden="true">
          <div class="image-placeholder-inner">
            <svg class="image-placeholder-icon" viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true">
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V5h14v14Zm-3-4-2.5-3.2a1 1 0 0 0-1.6 0L10 14l-.9-1.2a1 1 0 0 0-1.6 0L6 15.2V18h13v-3Zm-8.5-6.5A1.5 1.5 0 1 0 9 7a1.5 1.5 0 0 0-1.5 1.5Z"></path>
            </svg>
            <div class="image-placeholder-text">Afbeelding</div>
          </div>
        </div>`;
    const actionsHtml = renderActionsHtml(content?.actions);
    return `
        <div class="slide slide-image-text ${bg} ${fit} ${width} ${imgBg}${densityClass}" data-density="${density}">
          <div class="slide-inner">
            <div class="split ${side}">
              <div class="media" data-morph-role="image">
                <figure class="frame">
                  ${img}
                  ${caption}
                </figure>
              </div>
              <div class="copy">
                <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${esc(
                  content?.title
                )}</h2>
                <div class="body" data-morph-role="body" data-inline-field="body" data-inline-kind="markdown">${markdownToSafeHtml(
                  content?.body || ''
                )}</div>
                ${actionsHtml}
              </div>
            </div>
          </div>
        </div>
      `;
  },
};