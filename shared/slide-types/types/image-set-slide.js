import {
  bgClass,
  escapeHtml,
  imagePlaceholderHtml,
  objectPositionStyleAttrFromFocus,
  pickAltText,
  BACKGROUND_FIELD,
  IMAGE_ROLE_FIELD,
  IMAGE_SIDE_FIELD,
  IMAGE_WIDTH_FIELD,
  IMAGE_BACKGROUND_FIELD,
  densityField,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';
import { markdownToSafeHtml } from '../../markdown.js';
import { ACTIONS_FIELD, renderActionsHtml } from '../actions-field.js';
import {
  ASIDE_DEFAULTS,
  ASIDE_FIELDS,
  renderAsideHtml,
} from '../aside-field.js';
import {
  imageSetCellCount,
  resolveImageSetCell,
  ensureImageSetImages,
  IMAGE_SET_IMAGE_DEFAULTS,
  IMAGE_SET_MAX_IMAGES,
  IMAGE_SET_MIN_IMAGES,
} from './image-set-slide/images.js';

// A small set of images with one shared story. Split out of image-text-slide,
// whose plural layouts read images[0..2] while its split/corner layouts read a
// single flat image — one id carrying two contracts (D100).
export default {
  structure: 'collection',
  // A core-profile-only reader drops to the same slide with one image: title,
  // body and images[0]. The set shrinks, the story survives - which is exactly
  // what the deterministic conversion between the two types does.
  fallback: 'image-text-slide',
  runtime: 'static',
  label: 'Images + text',
  fields: [
    // Text first: `fields[]` order IS the form order on both surfaces (the bulk
    // "Edit all text" modal and the inspector's keeps pass), and the bulk modal
    // is a text-editing surface. The image machinery follows below.
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'body',
      label: 'Body (Markdown)',
      labelKey: 'editor.slideField.body.label',
      type: 'markdown',
      // Long-form prose beside the images: same as content-slide.
      toolbar: ['heading'],
      required: true,
      maxLength: 3000,
    },
    {
      // The set itself, and the only place an image lives on this type. Two is
      // the floor because one image beside text is an image-text-slide, not a
      // set; three is the ceiling because a fourth column stops reading.
      key: 'images',
      label: 'Images',
      labelKey: 'editor.slideField.images.label',
      type: 'items',
      required: true,
      minItems: IMAGE_SET_MIN_IMAGES,
      maxItems: IMAGE_SET_MAX_IMAGES,
      itemDefaults: { src: '', alt: '' },
      itemFields: [
        { key: 'src', label: 'Image URL', type: 'image', required: false },
        {
          key: 'alt',
          label: 'Alt text',
          labelKey: 'editor.slideField.alt.label',
          type: 'string',
          required: false,
          maxLength: 180,
        },
        {
          // Per-image fit; empty = follow the type default
          // (imageDefaults.fit), which is what the `image-fit` widget's
          // derived empty option says out loud.
          key: 'fit',
          label: 'Image fit',
          labelKey: 'editor.imageText.imageFit',
          type: 'enum',
          required: false,
          options: ['cover', 'contain'],
          editor: 'image-fit',
        },
        {
          // Carried data, not a form control: the crop point is edited by the
          // canvas focal-point drag and the "This image" card, both of which
          // resolve it through the inline descriptor. Same as gallery.
          key: 'focusX',
          label: 'Focus X',
          labelKey: 'editor.slideField.focusX.label',
          type: 'number',
          hidden: true,
          required: false,
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: 'focusY',
          label: 'Focus Y',
          labelKey: 'editor.slideField.focusY.label',
          type: 'number',
          hidden: true,
          required: false,
          min: 0,
          max: 100,
          step: 1,
        },
      ],
    },
    {
      // One caption for the whole set, rendered in the first frame.
      key: 'caption',
      label: 'Caption',
      labelKey: 'editor.slideField.caption.label',
      type: 'string',
      required: false,
      maxLength: 160,
    },
    IMAGE_ROLE_FIELD,
    {
      key: 'layout',
      label: 'Layout',
      labelKey: 'editor.slideField.layout.label',
      type: 'enum',
      required: false,
      options: [
        {
          value: 'beside',
          label: 'Beside text',
          title: 'Images stacked beside the text.',
        },
        {
          value: 'top',
          label: 'Row above',
          title:
            'A row of images above the text; the number of images sets the columns.',
        },
        {
          value: 'bottom',
          label: 'Row below',
          title:
            'A row of images below the text; the number of images sets the columns.',
        },
      ],
    },
    // Both drive the `beside` layout only; on a row the stored values are
    // remembered but inert, so switching back keeps the author's choice.
    IMAGE_SIDE_FIELD,
    IMAGE_WIDTH_FIELD,
    {
      // Applies in every layout of this type: the copy column is wide enough
      // for two columns whether the set sits beside it or above it.
      key: 'textColumns',
      label: 'Text columns',
      type: 'enum',
      required: false,
      options: [
        { value: '1', label: '1 column' },
        { value: '2', label: '2 columns' },
      ],
    },
    IMAGE_BACKGROUND_FIELD,
    // Two of the three shared stands: `auto` keeps the default sizing and
    // `compact` steps the copy down one size so more of it fits. There is no
    // `comfortable` branch in renderHtml below, so the field does not offer it.
    densityField(['auto', 'compact']),
    ...ASIDE_FIELDS,
    BACKGROUND_FIELD,
    ACTIONS_FIELD,
  ],
  // Layout catalogue for the editor's layout switcher (toolbar chip above the
  // slide). Declared on the definition - not hardcoded in the editor - so forks
  // that override this type by name control their own variant set. Same-type
  // tiles first, then the cross-type ones through the shared convert seam.
  // Grammar: see image-text-slide.js's block on the same key.
  layoutMirror: { key: 'imageSide', values: ['left', 'right'] },
  // No `when`: two text columns are offered in every layout this type has.
  layoutTextColumns: { key: 'textColumns', values: ['1', '2'] },
  layoutVariants: [
    {
      id: 'beside',
      labelKey: 'editor.layoutVariant.beside',
      label: 'Beside text',
      set: { layout: 'beside' },
      // `duo` is the schematic's drawing vocabulary for "stacked images beside
      // text" — a glyph name, not a content word.
      schematic: { duo: 45 },
    },
    {
      id: 'top',
      labelKey: 'editor.layoutVariant.rowTop',
      label: 'Row above',
      set: { layout: 'top' },
      schematic: { row: 'top' },
    },
    {
      id: 'bottom',
      labelKey: 'editor.layoutVariant.rowBottom',
      label: 'Row below',
      set: { layout: 'bottom' },
      schematic: { row: 'bottom' },
    },
    {
      id: 'split-half',
      labelKey: 'editor.layoutVariant.splitHalf',
      label: 'Image 1/2',
      convertTo: 'image-text-slide',
      set: { layout: 'split', imageWidth: 'half' },
      schematic: { split: 50 },
    },
    {
      id: 'text',
      labelKey: 'editor.layoutVariant.text',
      label: 'Text only',
      convertTo: 'content-slide',
      schematic: {},
    },
  ],
  // The ImageRef config anchor for this type (looked up, never stored per
  // slide): an item without its own fit/focus follows these. See
  // IMAGE_SET_IMAGE_DEFAULTS + docs/reference/image-property-ownership.md.
  imageDefaults: IMAGE_SET_IMAGE_DEFAULTS,
  // Shape-only materialization, run by the editor on open
  // (shared/slide-types/normalize-content.js). There is no legacy fold here:
  // this type never had slide-level image keys.
  normalizeContent: ensureImageSetImages,
  defaultsByLang: {
    nl: {
      images: [
        { src: '', alt: '' },
        { src: '', alt: '' },
      ],
      caption: '',
      imageRole: 'content',
      layout: 'top',
      imageSide: 'left',
      imageWidth: 'half',
      textColumns: '1',
      imageBackground: 'white',
      title: 'Nieuwe beeldreeks',
      body: '- Punt één\n- Punt twee',
      ...ASIDE_DEFAULTS,
      background: 'lime',
      actions: [],
    },
    'en-GB': {
      images: [
        { src: '', alt: '' },
        { src: '', alt: '' },
      ],
      caption: '',
      imageRole: 'content',
      layout: 'top',
      imageSide: 'left',
      imageWidth: 'half',
      textColumns: '1',
      imageBackground: 'white',
      title: 'New image set',
      body: '- Point one\n- Point two',
      ...ASIDE_DEFAULTS,
      background: 'lime',
      actions: [],
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    images: [
      { src: '', alt: '' },
      { src: '', alt: '' },
    ],
    caption: '',
    imageRole: 'content',
    layout: 'top',
    imageSide: 'left',
    imageWidth: 'half',
    textColumns: '1',
    imageBackground: 'white',
    density: 'auto',
    title: 'New image set',
    body: '- Point one\n- Point two',
    ...ASIDE_DEFAULTS,
    background: 'lime',
    actions: [],
  },
  renderHtml: (content, slide, ctx) => {
    const copy = getSlideCopy(ctx?.lang);
    const bg = bgClass(content?.background);
    const side = content?.imageSide === 'right' ? 'is-right' : 'is-left';
    const width =
      content?.imageWidth === 'narrow'
        ? 'is-image-narrow'
        : content?.imageWidth === 'wide'
          ? 'is-image-wide'
          : '';
    const layoutRaw = String(content?.layout || 'top');
    const layoutClass =
      layoutRaw === 'beside'
        ? ' is-layout-beside'
        : layoutRaw === 'bottom'
          ? ' is-layout-bottom'
          : ' is-layout-top';
    // Unconditional: every layout of this type has a copy column wide enough
    // to carry two columns, so the stored value always means what it says.
    const textColsClass =
      String(content?.textColumns) === '2' ? ' is-text-cols-2' : '';
    const imgBg =
      content?.imageBackground === 'match' ? 'is-image-bg-match' : '';
    // 'compact' takes the smaller copy size; anything else is the default.
    const densityClass = content?.density === 'compact' ? ' is-compact' : '';
    const caption = content?.caption
      ? `<figcaption class="caption" data-inline-field="caption" dir="auto">${escapeHtml(
          content.caption,
        )}</figcaption>`
      : '';
    const imageRole =
      content?.imageRole === 'decorative' ? 'decorative' : 'content';
    const ariaDecorative =
      imageRole === 'decorative' ? ' aria-hidden="true"' : '';
    // The set is the same size in every layout — the layout moves it, it does
    // not resize it.
    const cells = imageSetCellCount(content);
    // One <figure class="frame"> per cell, each carrying its *effective* fit as
    // an is-fit-* class - the single CSS mechanism for fit (frame padding). The
    // item-wins precedence lives in resolveImageSetCell, the single authority
    // render, the canvas focal drag and the inspector share.
    const cellHtml = (idx) => {
      const {
        item,
        fit: cellFit,
        focusSource,
        altExplicit,
      } = resolveImageSetCell(content, idx);
      const alt =
        imageRole === 'decorative'
          ? ''
          : pickAltText({
              explicit: altExplicit,
              src: item.src,
              fallbacks: idx === 0 ? [content?.caption, content?.title] : [],
              hardFallback: `Image ${idx + 1}`,
            });
      // For cover this controls crop focus; for contain, alignment.
      const focusStyle = objectPositionStyleAttrFromFocus(focusSource);
      const fitClass =
        cellFit === 'contain' ? ' is-fit-contain' : ' is-fit-cover';
      // data-inline-photo: clicking the image in the editor opens the
      // media popover (image + alt); inert on every other surface.
      const inner = item.src
        ? `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(
            alt,
          )}" data-inline-photo="${idx}"${ariaDecorative}${focusStyle} />`
        : imagePlaceholderHtml({ label: copy.imagePlaceholder, index: idx });
      // The shared caption lives in the first frame (absolute, bottom-left).
      return `<figure class="frame${fitClass}">
                  ${inner}
                  ${idx === 0 ? caption : ''}
                </figure>`;
    };
    const mediaCells = Array.from({ length: cells }, (_, i) =>
      cellHtml(i),
    ).join('');
    const actionsHtml = renderActionsHtml(content?.actions);
    // In the copy column, not over the images: the aside annotates the text it
    // sits with, and every layout variant moves the pictures around it.
    const asideHtml = renderAsideHtml(content, ctx);
    // The inner container keeps the `split is-left|is-right` classes so the
    // shared split CSS applies to the `beside` layout.
    return `
        <div class="slide slide-image-set ${bg} ${width} ${imgBg}${layoutClass}${textColsClass}${densityClass}">
          <div class="slide-inner">
            <div class="split ${side}">
              <div class="media is-multi" data-count="${cells}" data-morph-role="image">
                ${mediaCells}
              </div>
              <div class="copy">
                <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(
                  content?.title,
                )}</h2>
                <div class="body" data-morph-role="body" data-inline-field="body" data-inline-kind="markdown">${markdownToSafeHtml(
                  content?.body || '',
                )}</div>
                ${asideHtml}
                ${actionsHtml}
              </div>
            </div>
          </div>
        </div>
      `;
  },
};
