import {
  esc,
  imagePlaceholderInnerHtml,
  objectPositionStyleAttrFromFocus,
  pickAltText,
  getSubheadingText,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
  bgClass,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

export default {
  label: 'Image slide',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
      maxLength: 80,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 140,
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'image',
      label: 'Image',
      type: 'image',
      // Allow creating a new image slide without selecting an image yet.
      // Rendering/export already handle missing images gracefully.
      required: false,
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
      key: 'caption',
      label: 'Caption',
      type: 'string',
      required: false,
      maxLength: 160,
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
        'Only used in cropped layouts. 0 = left, 50 = center, 100 = right.',
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
        'Only used in cropped layouts. 0 = top, 50 = center, 100 = bottom.',
    },
    {
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      // Note: values are persisted in decks; keep them stable.
      // Labels explain the real behavior (cover/crop vs contain/no-crop).
      options: [
        {
          value: 'full',
          label: 'Fill (cropped)',
          title: 'Fills the frame and may crop the image (cover).',
          ariaLabel: 'Fill (cropped)',
        },
        {
          value: 'bleed',
          label: 'Full-bleed (cropped)',
          title:
            'Fills the entire slide edge-to-edge and may crop the image (cover).',
          ariaLabel: 'Full-bleed (cropped)',
        },
        {
          value: 'centered',
          label: 'Fit (no crop)',
          title: 'Shows the full image without cropping (contain).',
          ariaLabel: 'Fit (no crop)',
        },
      ],
    },
    BACKGROUND_FIELD,
    {
      key: 'zoomSteps',
      label: 'Zoom steps',
      type: 'enum',
      required: false,
      options: [
        {
          value: '',
          label: 'Disabled',
          title: 'No zoom steps during presentation.',
          ariaLabel: 'Disabled',
        },
        {
          value: 'corners',
          label: 'Corners (4 steps)',
          title: 'Zoom to top-left, top-right, bottom-left, bottom-right.',
          ariaLabel: 'Corners zoom',
        },
        {
          value: 'horizontal',
          label: 'Horizontal (2 steps)',
          title: 'Zoom left half, then right half.',
          ariaLabel: 'Horizontal zoom',
        },
        {
          value: 'vertical',
          label: 'Vertical (2 steps)',
          title: 'Zoom top half, then bottom half.',
          ariaLabel: 'Vertical zoom',
        },
        {
          value: 'quadrants',
          label: 'Quadrants (4 steps)',
          title: 'Zoom to each quadrant in reading order.',
          ariaLabel: 'Quadrants zoom',
        },
        {
          value: 'custom',
          label: 'Custom',
          title: 'Define custom zoom positions.',
          ariaLabel: 'Custom zoom',
        },
      ],
      helpText: 'Enable step-through zoom regions during presentation.',
    },
    {
      key: 'zoomLevel',
      label: 'Zoom level',
      type: 'number',
      required: false,
      min: 1.2,
      max: 5,
      step: 0.1,
      helpText: 'Zoom magnification (default: 2x). Higher = more zoom.',
    },
    {
      key: 'zoomPositions',
      label: 'Custom zoom positions',
      type: 'string',
      required: false,
      maxLength: 500,
      helpText: 'Custom positions as JSON array. X/Y are percentages (0-100).',
      helpCopyExample: '[{"x":25,"y":25},{"x":75,"y":25},{"x":25,"y":75},{"x":75,"y":75}]',
    },
  ],
  defaults: {
    title: '',
    subheading: '',
    bottomSubheading: '',
    image: '',
    alt: '',
    imageRole: 'content',
    caption: '',
    focusX: '',
    focusY: '',
    layout: 'full',
    background: 'lime',
    zoomSteps: '',
    zoomLevel: 2,
    zoomPositions: '',
  },
  renderHtml: (content, slide, ctx) => {
    const copy = getSlideCopy(ctx?.lang);
    const layout =
      content?.layout === 'centered'
        ? 'centered'
        : content?.layout === 'bleed'
          ? 'bleed'
          : 'full';
    const title = content?.title
      ? `<h2 class="img-title" data-inline-field="title" dir="auto">${esc(content.title)}</h2>`
      : '';
    const subheadingText = getSubheadingText(content);
    const subheading = subheadingText
      ? `<p class="subheading" data-inline-field="subheading" dir="auto">${esc(subheadingText)}</p>`
      : '';
    const heading =
      title || subheading ? `<div class="img-heading">${title}${subheading}</div>` : '';
    const hasBottom = hasBottomSubheading(content);
    const overlayHeading = layout === 'bleed' ? heading : '';
    const topHeading = layout === 'bleed' ? '' : heading;
    // For bleed layout, bottom subheading goes inside the frame as an overlay
    const bottomSubheadingOverlay = layout === 'bleed' ? renderBottomSubheadingHtml(content) : '';
    const bottomSubheadingBelow = layout === 'bleed' ? '' : renderBottomSubheadingHtml(content);
    const imageRole =
      content?.imageRole === 'decorative' ? 'decorative' : 'content';
    const altNl =
      typeof content?.altNl === 'string' ? content.altNl.trim() : '';
    const altEn =
      typeof content?.altEn === 'string' ? content.altEn.trim() : '';
    const altExplicit =
      typeof content?.alt === 'string' ? content.alt.trim() : '';
    const alt =
      imageRole === 'decorative'
        ? ''
        : pickAltText({
            explicit: altExplicit || altNl || altEn,
            src: content?.image,
            fallbacks: [content?.caption, content?.title, content?.subtitle],
            hardFallback: 'Image',
          });
    const img = content?.image
      ? (() => {
          // For cover layouts this controls the crop focus; for contain layout this controls alignment.
          const focusStyle = objectPositionStyleAttrFromFocus(content);
          const ariaDecorative =
            imageRole === 'decorative' ? ' aria-hidden="true"' : '';
          return `<img class="image" data-inline-photo="0" src="${esc(content.image)}" alt="${esc(
            alt
          )}"${ariaDecorative}${focusStyle} />`;
        })()
      : `<div class="image-placeholder is-empty" data-inline-photo="0" aria-hidden="true">
          ${imagePlaceholderInnerHtml(copy.imagePlaceholder)}
        </div>`;
    const caption = content?.caption
      ? `<figcaption class="caption" data-inline-field="caption" dir="auto">${esc(content.caption)}</figcaption>`
      : '';
    // Zoom step configuration for presenter mode
    const zoomSteps = content?.zoomSteps || '';
    const zoomLevel =
      typeof content?.zoomLevel === 'number' ? content.zoomLevel : 2;
    const zoomPositions = content?.zoomPositions || '';
    const zoomAttrs = zoomSteps
      ? ` data-zoom-steps="${esc(zoomSteps)}" data-zoom-level="${zoomLevel}"${
          zoomPositions ? ` data-zoom-positions="${esc(zoomPositions)}"` : ''
        }`
      : '';
    return `
        <div class="slide slide-image slide-image-${layout} ${bgClass(content?.background)}${
      topHeading ? ' has-heading' : ''
    }${hasBottom ? ' has-bottom-subheading' : ''}${zoomSteps ? ' has-zoom-steps' : ''}"${zoomAttrs}>
          <div class="slide-inner">
            ${topHeading}
            <div class="media" data-morph-role="image">
              <figure class="frame">
                ${img}
                ${overlayHeading}
                ${bottomSubheadingOverlay}
                ${caption}
              </figure>
            </div>
            ${bottomSubheadingBelow}
          </div>
        </div>
      `;
  },
};
