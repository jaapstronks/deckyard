import {
  bgClass,
  escapeHtml,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
  clampInt,
  pickAltText,
  objectPositionStyleAttrFromFocus,
  imagePlaceholderHtml,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

function safeImagesArr(images) {
  return Array.isArray(images) ? images : [];
}

function imageHtml(image, idx, copy) {
  const src = typeof image?.src === 'string' ? image.src.trim() : '';
  const caption =
    typeof image?.caption === 'string' ? image.caption.trim() : '';
  const altExplicit = typeof image?.alt === 'string' ? image.alt.trim() : '';
  const imageNum = idx + 1;

  if (!src) {
    return `
      <div class="gallery-item" data-item="${imageNum}" data-inline-item="images" data-inline-item-index="${idx}">
        ${imagePlaceholderHtml({ className: 'gallery-image-placeholder', label: `${copy.imagePlaceholder} ${imageNum}`, index: idx })}
        ${caption ? `<div class="gallery-caption" data-inline-field="images.${idx}.caption" dir="auto">${escapeHtml(caption)}</div>` : ''}
      </div>
    `;
  }

  const alt = pickAltText({
    explicit: altExplicit,
    src,
    fallbacks: [caption],
    hardFallback: `Gallery image ${imageNum}`,
  });

  const focusStyle = objectPositionStyleAttrFromFocus({
    focusX: image?.focusX,
    focusY: image?.focusY,
  });

  return `
    <div class="gallery-item" data-item="${imageNum}" data-inline-item="images" data-inline-item-index="${idx}">
      <img class="gallery-image" data-inline-photo="${idx}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"${focusStyle ? ` ${focusStyle}` : ''} />
      ${caption ? `<div class="gallery-caption" data-inline-field="images.${idx}.caption" dir="auto">${escapeHtml(caption)}</div>` : ''}
    </div>
  `;
}

export default {
  structure: 'collection',
  // A collection of images maps onto the image contract, not the list one. The
  // fallback names a contract rather than a one-for-one slide swap, so a reader
  // is free to emit one image slide per item.
  fallback: 'image-slide',
  runtime: 'static',
  label: 'Gallery',
  fields: [
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: false,
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
      key: 'layout',
      label: 'Layout',
      labelKey: 'editor.slideField.layout.label',
      type: 'enum',
      required: false,
      options: [
        { value: 'grid', label: 'Grid' },
        { value: 'masonry', label: 'Masonry' },
        { value: 'featured', label: 'Featured (1 large + small)' },
      ],
    },
    {
      key: 'images',
      label: 'Images',
      labelKey: 'editor.slideField.images.label',
      type: 'items',
      required: true,
      minItems: 2,
      maxItems: 6,
      collapsible: true, // item-rich: per-image collapse in the editor
      itemDefaults: {
        src: '',
        caption: '',
        alt: '',
      },
      itemFields: [
        {
          key: 'src',
          label: 'Image URL',
          labelKey: 'editor.slideField.imageUrl.label',
          type: 'image',
          required: true,
        },
        // Focus is carried data here, not editor surface (`hidden`): the
        // canvas focus handle and the inspector's image card own it.
        {
          key: 'focusX',
          label: 'Focus X',
          labelKey: 'editor.slideField.focusX.label',
          type: 'number',
          required: false,
          min: 0,
          max: 100,
          step: 1,
          hidden: true,
        },
        {
          key: 'focusY',
          label: 'Focus Y',
          labelKey: 'editor.slideField.focusY.label',
          type: 'number',
          required: false,
          min: 0,
          max: 100,
          step: 1,
          hidden: true,
        },
        {
          key: 'caption',
          label: 'Caption',
          labelKey: 'editor.slideField.caption.label',
          type: 'string',
          required: false,
          maxLength: 100,
        },
        {
          key: 'alt',
          label: 'Alt text',
          labelKey: 'editor.slideField.alt.label',
          type: 'string',
          required: false,
          maxLength: 200,
          placeholder: 'Describe the image',
        },
      ],
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: 'Fotogalerij',
      subheading: '',
      bottomSubheading: '',
      layout: 'grid',
      images: [
        {
          src: '/assets/images/backgrounds/demo-aurora.jpg',
          caption: '',
          alt: '',
        },
        {
          src: '/assets/images/backgrounds/demo-dusk.jpg',
          caption: '',
          alt: '',
        },
        {
          src: '/assets/images/backgrounds/demo-paper.jpg',
          caption: '',
          alt: '',
        },
        {
          src: '/assets/images/backgrounds/demo-moss.jpg',
          caption: '',
          alt: '',
        },
      ],
      background: 'mist',
    },
    'en-GB': {
      title: 'Photo gallery',
      subheading: '',
      bottomSubheading: '',
      layout: 'grid',
      images: [
        {
          src: '/assets/images/backgrounds/demo-aurora.jpg',
          caption: '',
          alt: '',
        },
        {
          src: '/assets/images/backgrounds/demo-dusk.jpg',
          caption: '',
          alt: '',
        },
        {
          src: '/assets/images/backgrounds/demo-paper.jpg',
          caption: '',
          alt: '',
        },
        {
          src: '/assets/images/backgrounds/demo-moss.jpg',
          caption: '',
          alt: '',
        },
      ],
      background: 'mist',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    title: 'Photo gallery',
    subheading: '',
    bottomSubheading: '',
    layout: 'grid',
    images: [
      {
        src: '/assets/images/backgrounds/demo-aurora.jpg',
        caption: '',
        alt: '',
      },
      { src: '/assets/images/backgrounds/demo-dusk.jpg', caption: '', alt: '' },
      {
        src: '/assets/images/backgrounds/demo-paper.jpg',
        caption: '',
        alt: '',
      },
      { src: '/assets/images/backgrounds/demo-moss.jpg', caption: '', alt: '' },
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

    const layout =
      content?.layout === 'masonry'
        ? 'masonry'
        : content?.layout === 'featured'
          ? 'featured'
          : 'grid';

    const images = safeImagesArr(content?.images).slice(0, 6);
    const count = clampInt(images.length, 2, 6, 4);

    const imagesHtml = images
      .slice(0, count)
      .map((image, idx) => imageHtml(image, idx, getSlideCopy(ctx?.lang)))
      .join('');

    return `
      <div class="slide slide-gallery ${bg}${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheadingHtml}</div>` : ''}
          <div class="gallery-container" data-layout="${layout}" data-count="${count}">
            ${imagesHtml}
          </div>
          ${bottomSubheadingHtml}
        </div>
      </div>
    `;
  },
};
