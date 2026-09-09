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
  resolveImageTextImage,
  IMAGE_TEXT_IMAGE_DEFAULTS,
} from './image-text-slide/image.js';

// One image beside text. The plural layouts this type used to carry (`duo`,
// `row-top`, `row-bottom`, reading images[0..2]) are `image-set-slide` since
// D100; the schema funnel moves stored decks over.
export default {
  structure: 'singleton',
  runtime: 'static',
  fidelity: { pptx: 'raster' },
  label: 'Image + text',
  fields: [
    // Text first: `fields[]` order IS the form order on both surfaces (the
    // bulk "Edit all text" modal and the inspector's keeps pass), and the bulk
    // modal is a text-editing surface. The image machinery follows below.
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
      // Long-form prose beside the image: same as content-slide.
      toolbar: ['heading'],
      required: true,
      maxLength: 3000,
    },
    {
      key: 'image',
      label: 'Image',
      labelKey: 'editor.slideField.image.label',
      type: 'image',
      required: false,
      // A picked image that would be heavily cropped switches to `contain`,
      // unless the author already chose a fit.
      autoFit: { fit: 'fit' },
    },
    IMAGE_ROLE_FIELD,
    {
      key: 'alt',
      label: 'Alt text',
      labelKey: 'editor.slideField.alt.label',
      type: 'string',
      required: false,
      maxLength: 180,
      // A decorative image is hidden from screen readers, so its alt text is
      // dead UI.
      visibleWhen: { field: 'imageRole', in: ['content'] },
    },
    {
      key: 'caption',
      label: 'Caption',
      labelKey: 'editor.slideField.caption.label',
      type: 'string',
      required: false,
      maxLength: 160,
    },
    {
      // Carried data, never a form control: the crop point is an ImageRef
      // property of the image ELEMENT, declared on the inline descriptor and
      // edited by the canvas focal-point drag and the "This image" card.
      key: 'focusX',
      label: 'Focus X',
      labelKey: 'editor.slideField.focusX.label',
      type: 'number',
      hidden: true,
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
      labelKey: 'editor.slideField.focusY.label',
      type: 'number',
      hidden: true,
      required: false,
      min: 0,
      max: 100,
      step: 1,
      helpText:
        'Only used when Image fit is “cover” (cropped). 0 = top, 50 = center, 100 = bottom.',
    },
    {
      // Canonical fit axis (ImageRef); empty = follow the type default
      // (imageDefaults.fit).
      key: 'fit',
      label: 'Image fit',
      // The ImageRef axes share one wording across every image type and every
      // surface, so they name the shared key rather than accept the per-type
      // one the registry would stamp.
      labelKey: 'editor.imageText.imageFit',
      type: 'enum',
      required: false,
      options: ['cover', 'contain'],
      // The silent-default widget: an extra empty option labelled with the
      // value imageDefaults.fit resolves to, which doubles as back-to-default.
      editor: 'image-fit',
      formLayout: 'pair',
    },
    IMAGE_SIDE_FIELD,
    IMAGE_WIDTH_FIELD,
    {
      // No `foldUnofferedTo` on purpose: the schema funnel's v14 -> v15 step
      // must still see a stored `duo`/`row-top`/`row-bottom` to move that
      // slide to image-set-slide. A fold here would eat the evidence first.
      key: 'layout',
      label: 'Layout',
      labelKey: 'editor.slideField.layout.label',
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
    IMAGE_BACKGROUND_FIELD,
    // Two of the three shared stands: `auto` keeps the default sizing and
    // `compact` steps the copy down one size so more of it fits. There is no
    // `comfortable` branch in renderHtml below, so the field does not offer it
    // — a stored one folds to `auto` (DENSITY_OPTIONS in helpers.js).
    densityField(['auto', 'compact']),
    ...ASIDE_FIELDS,
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
  //                       corner layout, { duo: <image %> } for two stacked
  //                       images beside the text, { row: 'top'|'bottom' }
  //                       for an image row, { textCols: 2 } for two text
  //                       columns, { cols: <n> } for n image+text columns,
  //                       {} for text-only. Mirrored live via the
  //                       layoutMirror field (rows/columns don't mirror).
  // The switcher popover also shows a mirror toggle when the definition
  // declares `layoutMirror`: which enum field flips the image side, and its
  // two values in [left, right] order. Declared here (JSON-safe) so forks
  // keep control per type; absent = no toggle.
  layoutMirror: { key: 'imageSide', values: ['left', 'right'] },
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
    // Cross-type: a second and third image is a different contract, so the
    // tile converts to image-set-slide instead of growing this one (D100).
    {
      id: 'beside',
      labelKey: 'editor.layoutVariant.beside',
      label: 'Beside text',
      convertTo: 'image-set-slide',
      set: { layout: 'beside' },
      schematic: { duo: 45 },
    },
    {
      id: 'top',
      labelKey: 'editor.layoutVariant.rowTop',
      label: 'Row above',
      convertTo: 'image-set-slide',
      set: { layout: 'top' },
      schematic: { row: 'top' },
    },
    {
      id: 'bottom',
      labelKey: 'editor.layoutVariant.rowBottom',
      label: 'Row below',
      convertTo: 'image-set-slide',
      set: { layout: 'bottom' },
      schematic: { row: 'bottom' },
    },
  ],
  // The ImageRef config anchor for this type (looked up, never stored per
  // slide): an image without its own fit/focus follows these. See
  // IMAGE_TEXT_IMAGE_DEFAULTS + docs/reference/image-property-ownership.md.
  imageDefaults: IMAGE_TEXT_IMAGE_DEFAULTS,
  // No `normalizeContent`: since D100 there is one shape and no legacy
  // slide-level key left to fold on touch — the schema funnel does the
  // migration once, at read time.
  defaultsByLang: {
    nl: {
      image: '',
      caption: '',
      alt: '',
      imageRole: 'content',
      imageSide: 'left',
      imageWidth: 'half',
      layout: 'split',
      imageBackground: 'white',
      focusX: '',
      focusY: '',
      title: 'Nieuwe slide (split)',
      body: '- Punt één\n- Punt twee',
      ...ASIDE_DEFAULTS,
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
      imageBackground: 'white',
      focusX: '',
      focusY: '',
      title: 'New split slide',
      body: '- Point one\n- Point two',
      ...ASIDE_DEFAULTS,
      background: 'lime',
      actions: [],
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    image: '',
    caption: '',
    alt: '',
    imageRole: 'content',
    imageSide: 'left',
    imageWidth: 'half',
    layout: 'split',
    imageBackground: 'white',
    density: 'auto',
    focusX: '',
    focusY: '',
    title: 'New split slide',
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
    // `split` is the base layout and carries no class of its own.
    const layoutClass =
      String(content?.layout || 'split') === 'corner'
        ? ' is-layout-corner'
        : '';
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
    // The one <figure class="frame"> carries its effective fit as an is-fit-*
    // class - the single CSS mechanism for fit (frame padding). Whether the fit
    // came from the slide or the type default is invisible in the emitted HTML
    // (see docs/reference/image-property-ownership.md).
    const {
      src,
      alt: altExplicit,
      fit,
      focusX,
      focusY,
    } = resolveImageTextImage(content);
    const alt =
      imageRole === 'decorative'
        ? ''
        : pickAltText({
            explicit: altExplicit,
            src,
            fallbacks: [content?.caption, content?.title],
            hardFallback: 'Image',
          });
    // For cover this controls crop focus; for contain, alignment.
    const focusStyle = objectPositionStyleAttrFromFocus({ focusX, focusY });
    const fitClass = fit === 'contain' ? ' is-fit-contain' : ' is-fit-cover';
    // data-inline-photo: clicking the image in the editor opens the media
    // popover (image + alt); inert on every other surface.
    const inner = src
      ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(
          alt,
        )}" data-inline-photo="0"${ariaDecorative}${focusStyle} />`
      : imagePlaceholderHtml({ label: copy.imagePlaceholder, index: 0 });
    const actionsHtml = renderActionsHtml(content?.actions);
    // In the copy column, not over the image: the aside annotates the text it
    // sits with, and every layout variant moves the picture around it.
    const asideHtml = renderAsideHtml(content, ctx);
    return `
        <div class="slide slide-image-text ${bg} ${width} ${imgBg}${layoutClass}${densityClass}">
          <div class="slide-inner">
            <div class="split ${side}">
              <div class="media" data-morph-role="image">
                <figure class="frame${fitClass}">
                  ${inner}
                  ${caption}
                </figure>
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
