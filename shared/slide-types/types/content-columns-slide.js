import {
  esc,
  pickAltText,
  renderSubheadingHtml,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  objectPositionStyleAttrFromFocus,
  imagePlaceholderHtml,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';
import { markdownToSafeHtml } from '../../markdown.js';
import {
  resolveContentColumnImage,
  CONTENT_COLUMNS_IMAGE_DEFAULTS,
} from '../content-columns-images.js';

export const MAX_COLUMNS = 7;
export const MAX_TEXT_BLOCKS = 5;

function generateColumnFields(colNum) {
  const fields = [
    // Title block
    {
      key: `col${colNum}Title`,
      label: `Column ${colNum} title`,
      type: 'string',
      required: false,
      maxLength: 80,
    },
    {
      key: `col${colNum}Text`,
      label: `Column ${colNum} text`,
      type: 'markdown',
      required: false,
      maxLength: 500,
    },
    // Image
    {
      key: `col${colNum}Image`,
      label: `Column ${colNum} image`,
      type: 'image',
      required: false,
    },
    {
      key: `col${colNum}ImageFit`,
      label: `Column ${colNum} image fit`,
      type: 'enum',
      required: false,
      options: [
        { value: 'cover', label: 'Cropped (16:9)' },
        { value: 'contain', label: 'Fixed height' },
      ],
    },
    {
      key: `col${colNum}ImageFocusX`,
      label: `Column ${colNum} image focus X`,
      type: 'number',
      required: false,
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: `col${colNum}ImageFocusY`,
      label: `Column ${colNum} image focus Y`,
      type: 'number',
      required: false,
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: `col${colNum}Alt`,
      label: `Column ${colNum} image alt text`,
      type: 'string',
      required: false,
      maxLength: 180,
    },
    // Text blocks count
    {
      key: `col${colNum}BlockCount`,
      label: `Column ${colNum} text blocks`,
      type: 'enum',
      required: false,
      options: ['0', '1', '2', '3', '4', '5'],
    },
  ];

  // Text blocks (title + body for each)
  for (let i = 1; i <= MAX_TEXT_BLOCKS; i++) {
    fields.push({
      key: `col${colNum}Block${i}Title`,
      label: `Column ${colNum} block ${i} title`,
      type: 'string',
      required: false,
      maxLength: 80,
    });
    fields.push({
      key: `col${colNum}Block${i}Body`,
      label: `Column ${colNum} block ${i} body`,
      type: 'markdown',
      required: false,
      maxLength: 500,
    });
  }

  return fields;
}

function generateColumnDefaults(colNum, lang) {
  const labels = lang === 'nl'
    ? { title: `Kolom ${colNum}`, text: '', blockTitle: 'Blok', blockBody: 'Tekst hier' }
    : { title: `Column ${colNum}`, text: '', blockTitle: 'Block', blockBody: 'Text here' };

  // NB: no col{n}ImageFit / col{n}ImageFocusX/Y here (datamodel step 4).
  // Those are ImageRef properties whose defaults live in the type config
  // (CONTENT_COLUMNS_IMAGE_DEFAULTS); stamping them onto every new deck
  // would freeze the deck against a future default change and erase the
  // empty-means-follow-the-type signal.
  const defaults = {
    [`col${colNum}Title`]: labels.title,
    [`col${colNum}Text`]: labels.text,
    [`col${colNum}Image`]: '',
    [`col${colNum}Alt`]: '',
    [`col${colNum}BlockCount`]: '1',
  };

  for (let i = 1; i <= MAX_TEXT_BLOCKS; i++) {
    defaults[`col${colNum}Block${i}Title`] = i === 1 ? `${labels.blockTitle} 1` : '';
    defaults[`col${colNum}Block${i}Body`] = i === 1 ? labels.blockBody : '';
  }

  return defaults;
}

export default {
  // Archived: retired as an authoring surface (decided 2026-07-22). It was the
  // only type with the rich nested column structure (heading + image + several
  // sub-items per column), which is the heaviest reader/reflow projection case,
  // and it barely earned its keep — a near-copy of a one-off custom slide. Kept
  // registered + render-only so existing decks render unchanged; `deprecated`
  // removes it from the picker (isInsertableSlideType) and it is listed in the
  // AI generator's EXCLUDED_TYPES, so no new content-columns slides are authored.
  // Existing instances are surfaced by scripts/scan-slide-type.js and converted
  // (to text-blocks / icon-cards) or PNG-replaced before this lands, rather than
  // silently deprecated. Mirrors the freeform (#252) / split-partner (#197)
  // archival precedent. Want this layout back later → a custom slide or a future
  // explicit rich-nested type; not carried as core now.
  deprecated: true,
  label: 'Content columns',
  fields: [
    // Header
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    // Column count
    {
      key: 'columnCount',
      label: 'Number of columns',
      type: 'enum',
      required: false,
      options: ['1', '2', '3', '4', '5', '6', '7'],
    },
    // Generate fields for all columns
    ...Array.from({ length: MAX_COLUMNS }, (_, i) => generateColumnFields(i + 1)).flat(),
  ],

  // The ImageRef config anchor for this type (looked up, never stored per
  // slide): a column image without its own fit/focus follows these. See
  // CONTENT_COLUMNS_IMAGE_DEFAULTS + docs/reference/image-property-ownership.md.
  imageDefaults: CONTENT_COLUMNS_IMAGE_DEFAULTS,

  defaultsByLang: {
    nl: {
      title: '',
      subheading: '',
      bottomSubheading: '',
      columnCount: '2',
      ...generateColumnDefaults(1, 'nl'),
      ...generateColumnDefaults(2, 'nl'),
      ...generateColumnDefaults(3, 'nl'),
      ...generateColumnDefaults(4, 'nl'),
      ...generateColumnDefaults(5, 'nl'),
      ...generateColumnDefaults(6, 'nl'),
      ...generateColumnDefaults(7, 'nl'),
    },
    'en-GB': {
      title: '',
      subheading: '',
      bottomSubheading: '',
      columnCount: '2',
      ...generateColumnDefaults(1, 'en'),
      ...generateColumnDefaults(2, 'en'),
      ...generateColumnDefaults(3, 'en'),
      ...generateColumnDefaults(4, 'en'),
      ...generateColumnDefaults(5, 'en'),
      ...generateColumnDefaults(6, 'en'),
      ...generateColumnDefaults(7, 'en'),
    },
  },

  defaults: {
    title: '',
    subtitle: '',
    columnCount: '3',
    ...generateColumnDefaults(1, 'en'),
    ...generateColumnDefaults(2, 'en'),
    ...generateColumnDefaults(3, 'en'),
    ...generateColumnDefaults(4, 'en'),
    ...generateColumnDefaults(5, 'en'),
    ...generateColumnDefaults(6, 'en'),
    ...generateColumnDefaults(7, 'en'),
  },

  renderHtml: (content, _slide, ctx) => {
    const copy = getSlideCopy(ctx?.lang);
    const title = typeof content?.title === 'string' && content.title.trim()
      ? `<h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
      : '';
    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const hasHeader = !!(title || subheading);
    const bottomSubheading = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);

    const columnCount = Math.max(1, Math.min(MAX_COLUMNS, Number(content?.columnCount) || 3));

    function renderColumn(colNum) {
      const colTitle = content?.[`col${colNum}Title`] || '';
      const colText = content?.[`col${colNum}Text`] || '';
      // Per-column image resolution (own value -> type default) through the
      // single ImageRef authority the editor controls and conversion share.
      const img = resolveContentColumnImage(content, colNum);
      const blockCount = Math.max(0, Math.min(MAX_TEXT_BLOCKS, Number(content?.[`col${colNum}BlockCount`]) || 0));

      // Title block
      const titleHtml = colTitle.trim()
        ? `<div class="cc-col-title" data-inline-field="col${colNum}Title" dir="auto">${esc(colTitle.trim())}</div>`
        : '';
      const textHtml = colText.trim()
        ? `<div class="cc-col-text" data-inline-field="col${colNum}Text">${markdownToSafeHtml(colText.trim())}</div>`
        : '';
      const titleBlockHtml = (titleHtml || textHtml)
        ? `<div class="cc-title-block">${titleHtml}${textHtml}</div>`
        : '';

      // Image
      let imageHtml = '';
      if (img.src) {
        const alt = pickAltText({
          explicit: img.alt,
          src: img.src,
          fallbacks: [colTitle],
          hardFallback: 'Image',
        });
        const fitClass = img.fit === 'contain' ? 'is-contain' : 'is-cover';
        // Only apply focus position for cover mode (cropped images)
        const focusStyle = img.fit === 'cover'
          ? objectPositionStyleAttrFromFocus({ focusX: img.focusX, focusY: img.focusY })
          : '';
        // Inline-edit hook: clicking a column image opens a media popover
        // (image + alt) writing to the flat col{n}Image / col{n}Alt fields.
        imageHtml = `
          <div class="cc-image ${fitClass}" data-inline-photo="${colNum}">
            <img src="${esc(img.src)}" alt="${esc(alt)}"${focusStyle ? ` ${focusStyle}` : ''} />
          </div>
        `;
      } else if (ctx?.mode === 'edit') {
        // Editor canvas only: an image-less column is a legitimate layout, so
        // no placeholder ships to present/export - but in the editor an empty
        // slot must be clickable to add a FIRST image (media popover).
        imageHtml = `
          ${imagePlaceholderHtml({ className: 'cc-image is-cover cc-image-placeholder', label: copy.imagePlaceholder, index: colNum })}
        `;
      }

      // Text blocks
      const blocks = [];
      for (let i = 1; i <= blockCount; i++) {
        const blockTitle = content?.[`col${colNum}Block${i}Title`] || '';
        const blockBody = content?.[`col${colNum}Block${i}Body`] || '';

        const blockTitleHtml = blockTitle.trim()
          ? `<div class="cc-block-title" data-inline-field="col${colNum}Block${i}Title" dir="auto">${esc(blockTitle.trim())}</div>`
          : '';
        const blockBodyHtml = blockBody.trim()
          ? `<div class="cc-block-body" data-inline-field="col${colNum}Block${i}Body">${markdownToSafeHtml(blockBody.trim())}</div>`
          : '';

        if (blockTitleHtml || blockBodyHtml) {
          blocks.push(`
            <div class="cc-text-block">
              ${blockTitleHtml}
              ${blockBodyHtml}
            </div>
          `);
        }
      }
      const blocksHtml = blocks.length
        ? `<div class="cc-text-blocks">${blocks.join('')}</div>`
        : '';

      return `
        <div class="cc-column">
          ${titleBlockHtml}
          ${imageHtml}
          ${blocksHtml}
        </div>
      `;
    }

    const columns = [];
    for (let i = 1; i <= columnCount; i++) {
      columns.push(renderColumn(i));
    }

    return `
      <div class="slide slide-content-columns slide-bg-mist${hasHeader ? ' has-header' : ''}${hasBottom ? ' has-bottom-subheading' : ''}" data-column-count="${columnCount}">
        <div class="slide-inner">
          ${hasHeader ? `<div class="header">${title}${subheading}</div>` : ''}
          <div class="cc-columns">
            ${columns.join('')}
          </div>
          ${bottomSubheading}
        </div>
      </div>
    `;
  },
};