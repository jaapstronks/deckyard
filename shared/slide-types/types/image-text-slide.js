import {
  bgClass,
  esc,
  imagePlaceholderInnerHtml,
  objectPositionStyleAttrFromFocus,
  pickAltText,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';
import { markdownToSafeHtml } from '../../markdown.js';
import { ACTIONS_FIELD, renderActionsHtml } from '../actions-field.js';
import {
  imageTextImageItems,
  imageTextCellCount,
} from '../image-text-images.js';

export default {
  label: 'Image + text',
  fields: [
    {
      // LEGACY single-image field. Since the phase-2 layout catalogue the
      // canonical field is `images` below; this one stays declared so old
      // decks keep validating, translating and collab-syncing, and renders
      // as item 0 when images[] is empty. The editor migrates it on touch
      // (ensureImageTextImages).
      key: 'image',
      label: 'Image',
      type: 'image',
      required: false,
    },
    {
      key: 'images',
      label: 'Images',
      type: 'items',
      required: false,
      minItems: 0,
      maxItems: 3,
      itemDefaults: { src: '', alt: '' },
      itemFields: [
        { key: 'src', label: 'Image URL', type: 'image', required: false },
        {
          key: 'alt',
          label: 'Alt text',
          type: 'string',
          required: false,
          maxLength: 180,
        },
        {
          // Per-image escape for non-croppable images (logos, diagrams);
          // empty = follow the slide-level Image fit.
          key: 'fit',
          label: 'Image fit',
          type: 'enum',
          required: false,
          options: ['cover', 'contain'],
        },
        {
          key: 'focusX',
          label: 'Focus X',
          type: 'number',
          required: false,
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: 'focusY',
          label: 'Focus Y',
          type: 'number',
          required: false,
          min: 0,
          max: 100,
          step: 1,
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
        {
          value: 'duo',
          label: 'Two beside text',
          title: 'Two images stacked beside the text.',
        },
        {
          value: 'row-top',
          label: 'Row above',
          title:
            'A row of 2-3 images above the text; the number of images sets the columns.',
        },
        {
          value: 'row-bottom',
          label: 'Row below',
          title:
            'A row of 2-3 images below the text; the number of images sets the columns.',
        },
      ],
    },
    {
      key: 'textColumns',
      label: 'Text columns',
      type: 'enum',
      required: false,
      helpText: 'Only used in the image-row and duo layouts.',
      options: [
        { value: '1', label: '1 column' },
        { value: '2', label: '2 columns' },
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
  // Second popover toggle: text in one or two columns. Same fork story as
  // layoutMirror (JSON-safe, declared per type; absent = no toggle):
  //   key/values - the enum field and its two values in [one, two] order;
  //   when       - only offered while this enum field holds one of these
  //                values (the wide-copy layouts; elsewhere the stored value
  //                is remembered but inert, like imageSide on a row).
  layoutTextColumns: {
    key: 'textColumns',
    values: ['1', '2'],
    when: { key: 'layout', values: ['row-top', 'row-bottom', 'duo'] },
  },
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
      id: 'row-top',
      labelKey: 'editor.layoutVariant.rowTop',
      label: 'Row above',
      set: { layout: 'row-top' },
      schematic: { row: 'top' },
    },
    {
      id: 'row-bottom',
      labelKey: 'editor.layoutVariant.rowBottom',
      label: 'Row below',
      set: { layout: 'row-bottom' },
      schematic: { row: 'bottom' },
    },
    {
      id: 'duo',
      labelKey: 'editor.layoutVariant.duo',
      label: 'Two beside text',
      set: { layout: 'duo' },
      schematic: { duo: 45 },
    },
    {
      id: 'corner',
      labelKey: 'editor.layoutVariant.corner',
      label: 'Corner image',
      set: { layout: 'corner' },
      schematic: { corner: 45 },
    },
    {
      // Cross-type exit for "I want my own text per image": the convert seam
      // maps title/body/images onto content-columns columns.
      id: 'columns',
      labelKey: 'editor.layoutVariant.columns',
      label: 'Own text per column',
      convertTo: 'content-columns-slide',
      schematic: { cols: 3 },
    },
  ],
  defaultsByLang: {
    nl: {
      image: '',
      images: [],
      caption: '',
      alt: '',
      imageRole: 'content',
      imageSide: 'left',
      imageWidth: 'half',
      layout: 'split',
      textColumns: '1',
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
      images: [],
      caption: '',
      alt: '',
      imageRole: 'content',
      imageSide: 'left',
      imageWidth: 'half',
      layout: 'split',
      textColumns: '1',
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
    textColumns: '1',
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
  renderHtml: (content, slide, ctx) => {
    const copy = getSlideCopy(ctx?.lang);
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
    const layoutRaw = String(content?.layout || 'split');
    const layoutClass =
      layoutRaw === 'corner'
        ? ' is-layout-corner'
        : layoutRaw === 'duo'
          ? ' is-layout-duo'
          : layoutRaw === 'row-top'
            ? ' is-layout-row-top'
            : layoutRaw === 'row-bottom'
              ? ' is-layout-row-bottom'
              : '';
    // Two text columns only apply in the wide-copy layouts (rows/duo);
    // elsewhere the stored value is remembered but inert, so a split slide
    // never inherits phantom columns (same model as imageSide on a row).
    const textColsClass =
      String(content?.textColumns) === '2' &&
      (layoutRaw === 'duo' ||
        layoutRaw === 'row-top' ||
        layoutRaw === 'row-bottom')
        ? ' is-text-cols-2'
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
    const ariaDecorative =
      imageRole === 'decorative' ? ' aria-hidden="true"' : '';
    const items = imageTextImageItems(content);
    const cells = imageTextCellCount(content);
    // One <figure class="frame"> per cell. Item 0 falls back to the legacy
    // slide-level alt/focus so unmigrated decks render identically; a
    // per-item fit only adds a class when it overrides the slide-level fit.
    const cellHtml = (idx) => {
      const item = items[idx] || {
        src: '',
        alt: '',
        fit: '',
        focusX: '',
        focusY: '',
      };
      const itemAlt =
        typeof item.alt === 'string' && item.alt.trim()
          ? item.alt.trim()
          : idx === 0
            ? altExplicit || altNl || altEn
            : '';
      const alt =
        imageRole === 'decorative'
          ? ''
          : pickAltText({
              explicit: itemAlt,
              src: item.src,
              fallbacks: idx === 0 ? [content?.caption, content?.title] : [],
              hardFallback: cells > 1 ? `Image ${idx + 1}` : 'Image',
            });
      // For cover this controls crop focus; for contain, alignment.
      const hasOwnFocus = item.focusX !== '' || item.focusY !== '';
      const focusStyle = objectPositionStyleAttrFromFocus(
        hasOwnFocus || idx > 0 ? item : content
      );
      const fitClass =
        item.fit === 'contain'
          ? ' is-fit-contain'
          : item.fit === 'cover'
            ? ' is-fit-cover'
            : '';
      // data-inline-photo: clicking the image in the editor opens the
      // media popover (image + alt); inert on every other surface.
      const inner = item.src
        ? `<img src="${esc(item.src)}" alt="${esc(
            alt
          )}" data-inline-photo="${idx}"${ariaDecorative}${focusStyle} />`
        : `<div class="image-placeholder is-empty" data-inline-photo="${idx}" aria-hidden="true">
          ${imagePlaceholderInnerHtml(copy.imagePlaceholder)}
        </div>`;
      // The shared caption lives in the first frame (absolute, bottom-left).
      return `<figure class="frame${fitClass}">
                  ${inner}
                  ${idx === 0 ? caption : ''}
                </figure>`;
    };
    const mediaCells = Array.from({ length: cells }, (_, i) => cellHtml(i)).join('');
    const mediaMulti = cells > 1 ? ` is-multi` : '';
    const mediaCount = cells > 1 ? ` data-count="${cells}"` : '';
    const actionsHtml = renderActionsHtml(content?.actions);
    return `
        <div class="slide slide-image-text ${bg} ${fit} ${width} ${imgBg}${layoutClass}${textColsClass}${densityClass}" data-density="${density}">
          <div class="slide-inner">
            <div class="split ${side}">
              <div class="media${mediaMulti}"${mediaCount} data-morph-role="image">
                ${mediaCells}
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