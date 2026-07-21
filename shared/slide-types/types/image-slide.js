import {
  esc,
  imagePlaceholderHtml,
  objectPositionStyleAttrFromFocus,
  pickAltText,
  getSubheadingText,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  BACKGROUND_FIELD,
  bgClass,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';
import {
  resolveImageSlideImage,
  IMAGE_SLIDE_IMAGE_DEFAULTS,
} from '../image-slide-image.js';

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
      // Canonical fit axis (ImageRef, datamodel step 3); empty = follow the
      // type default (imageDefaults.fit).
      key: 'fit',
      label: 'Image fit',
      type: 'enum',
      required: false,
      options: ['cover', 'contain'],
    },
    {
      // Canonical frame axis (ImageRef): edge-to-edge, orthogonal to fit -
      // contain + bleed (image fits, frame runs to the slide edge) is a state
      // the old three-value `layout` could not express. Boolean; absent =
      // follow the type default (imageDefaults.bleed).
      key: 'bleed',
      label: 'Edge-to-edge',
      type: 'boolean',
      required: false,
    },
    {
      // LEGACY conflated fit+frame enum. Since datamodel step 3 the canonical
      // axes are `fit` + `bleed` above (full -> cover, bleed -> cover+bleed,
      // centered -> contain); this field stays declared so old decks keep
      // validating and rendering, and the editor folds it on touch
      // (ensureImageSlideImage).
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      options: ['full', 'bleed', 'centered'],
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
  // The ImageRef config anchor for this type (looked up, never stored per
  // slide): an image without its own fit/bleed follows these. See
  // IMAGE_SLIDE_IMAGE_DEFAULTS + docs/reference/image-property-ownership.md.
  imageDefaults: IMAGE_SLIDE_IMAGE_DEFAULTS,
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
    background: 'lime',
    zoomSteps: '',
    zoomLevel: 2,
    zoomPositions: '',
  },
  renderHtml: (content, slide, ctx) => {
    const copy = getSlideCopy(ctx?.lang);
    // Two orthogonal axis classes (is-fit-* + is-bleed) replace the old
    // conflated slide-image-{full,bleed,centered} layout class. Resolution
    // (own value -> legacy `layout` -> type default) lives in
    // resolveImageSlideImage - the single authority render, the editor
    // controls and the conversion seam share.
    const { fit, bleed } = resolveImageSlideImage(content);
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
    // On a bleed frame the heading and bottom subheading overlay the image
    // (there is no padded area to sit in) - keyed on the bleed axis alone, so
    // contain + bleed overlays too.
    const overlayHeading = bleed ? heading : '';
    const topHeading = bleed ? '' : heading;
    const bottomSubheadingOverlay = bleed ? renderBottomSubheadingHtml(content) : '';
    const bottomSubheadingBelow = bleed ? '' : renderBottomSubheadingHtml(content);
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
      : imagePlaceholderHtml({ label: copy.imagePlaceholder, index: 0 });
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
        <div class="slide slide-image is-fit-${fit}${bleed ? ' is-bleed' : ''} ${bgClass(content?.background)}${
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
