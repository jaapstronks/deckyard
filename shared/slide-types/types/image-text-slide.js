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
      // narrow/half/wide double as the catalogue's 1/3, 1/2 and 2/3 splits
      // (37/63 mirrors 63/37, so no fourth value is needed).
      options: [
        { value: 'half', label: '50%' },
        { value: 'narrow', label: '37%' },
        { value: 'wide', label: '63%' },
      ],
    },
    {
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      options: [
        { value: 'split', label: 'Split' },
        {
          value: 'corner',
          label: 'Corner image',
          title:
            'Image only in the top corner; the space below stays empty. Fits little text.',
        },
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
  // Layout catalogue for the editor's layout switcher (toolbar chip above the
  // slide). Declared on the definition - not hardcoded in the editor - so
  // forks that override this type by name control their own variant set.
  // JSON-safe by design: custom types receive definitions via /api/slide-types.
  //   id/labelKey/label - tile identity and copy;
  //   set               - content-field updates that select the variant
  //                       (matched against content with these defaults);
  //   convertTo         - cross-type tile through the shared convert seam
  //                       (only shown when the seam supports it);
  //   schematic         - mini-tile drawing: { split: <image %> } for a
  //                       side-by-side split, { corner: <image %> } for the
  //                       corner layout, {} for text-only. Mirrored live via
  //                       content.imageSide.
  layoutVariants: [
    {
      id: 'text',
      labelKey: 'editor.layoutVariant.text',
      label: 'Text only',
      convertTo: 'content-slide',
      schematic: {},
    },
    {
      id: 'split-narrow',
      labelKey: 'editor.layoutVariant.splitNarrow',
      label: 'Image 1/3',
      set: { layout: 'split', imageWidth: 'narrow' },
      schematic: { split: 37 },
    },
    {
      id: 'split-half',
      labelKey: 'editor.layoutVariant.splitHalf',
      label: 'Image 1/2',
      set: { layout: 'split', imageWidth: 'half' },
      schematic: { split: 50 },
    },
    {
      id: 'split-wide',
      labelKey: 'editor.layoutVariant.splitWide',
      label: 'Image 2/3',
      set: { layout: 'split', imageWidth: 'wide' },
      schematic: { split: 63 },
    },
    {
      id: 'corner',
      labelKey: 'editor.layoutVariant.corner',
      label: 'Corner image',
      set: { layout: 'corner' },
      schematic: { corner: 45 },
    },
  ],
  defaultsByLang: {
    nl: {
      image: '',
      caption: '',
      alt: '',
      imageRole: 'content',
      imageSide: 'left',
      imageWidth: 'half',
      layout: 'split',
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
      layout: 'split',
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
    layout: 'split',
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
        : content?.imageWidth === 'wide'
          ? 'is-image-wide'
          : '';
    const layoutClass =
      content?.layout === 'corner' ? ' is-layout-corner' : '';
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
          // data-inline-photo: clicking the image in the editor opens the
          // media popover (image + alt); inert on every other surface.
          return `<img src="${esc(content.image)}" alt="${esc(
            alt
          )}" data-inline-photo="0"${ariaDecorative}${focusStyle} />`;
        })()
      : `<div class="image-placeholder is-empty" data-inline-photo="0" aria-hidden="true">
          <div class="image-placeholder-inner">
            <svg class="image-placeholder-icon" viewBox="0 0 24 24" role="presentation" focusable="false" aria-hidden="true">
              <path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H5V5h14v14Zm-3-4-2.5-3.2a1 1 0 0 0-1.6 0L10 14l-.9-1.2a1 1 0 0 0-1.6 0L6 15.2V18h13v-3Zm-8.5-6.5A1.5 1.5 0 1 0 9 7a1.5 1.5 0 0 0-1.5 1.5Z"></path>
            </svg>
            <div class="image-placeholder-text">Afbeelding</div>
          </div>
        </div>`;
    const actionsHtml = renderActionsHtml(content?.actions);
    return `
        <div class="slide slide-image-text ${bg} ${fit} ${width} ${imgBg}${layoutClass}${densityClass}" data-density="${density}">
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