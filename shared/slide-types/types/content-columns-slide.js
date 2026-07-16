import {
  esc,
  pickAltText,
  getSubheadingText,
  renderBottomSubheadingHtml,
  hasBottomSubheading,
  objectPositionStyleAttrFromFocus,
} from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

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

  const defaults = {
    [`col${colNum}Title`]: labels.title,
    [`col${colNum}Text`]: labels.text,
    [`col${colNum}Image`]: '',
    [`col${colNum}ImageFit`]: 'cover',
    [`col${colNum}ImageFocusX`]: 50,
    [`col${colNum}ImageFocusY`]: 50,
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

  defaultsByLang: {
    nl: {
      title: '',
      subheading: '',
      bottomSubheading: '',
      columnCount: '3',
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
      columnCount: '3',
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
    const title = typeof content?.title === 'string' && content.title.trim()
      ? `<h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
      : '';
    const subheadingText = getSubheadingText(content);
    const subheading = subheadingText
      ? `<p class="subheading" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${esc(subheadingText)}</p>`
      : '';
    const hasHeader = !!(title || subheading);
    const bottomSubheading = renderBottomSubheadingHtml(content);
    const hasBottom = hasBottomSubheading(content);

    const columnCount = Math.max(1, Math.min(MAX_COLUMNS, Number(content?.columnCount) || 3));

    function renderColumn(colNum) {
      const colTitle = content?.[`col${colNum}Title`] || '';
      const colText = content?.[`col${colNum}Text`] || '';
      const colImage = content?.[`col${colNum}Image`] || '';
      const colImageFit = content?.[`col${colNum}ImageFit`] || 'cover';
      const colImageFocusX = content?.[`col${colNum}ImageFocusX`];
      const colImageFocusY = content?.[`col${colNum}ImageFocusY`];
      const colAlt = content?.[`col${colNum}Alt`] || '';
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
      if (colImage) {
        const alt = pickAltText({
          explicit: colAlt,
          src: colImage,
          fallbacks: [colTitle],
          hardFallback: 'Image',
        });
        const fitClass = colImageFit === 'contain' ? 'is-contain' : 'is-cover';
        // Only apply focus position for cover mode (cropped images)
        const focusStyle = colImageFit === 'cover'
          ? objectPositionStyleAttrFromFocus({ focusX: colImageFocusX, focusY: colImageFocusY })
          : '';
        // Inline-edit hook: clicking a column image opens a media popover
        // (image + alt) writing to the flat col{n}Image / col{n}Alt fields.
        imageHtml = `
          <div class="cc-image ${fitClass}" data-inline-photo="${colNum}">
            <img src="${esc(colImage)}" alt="${esc(alt)}"${focusStyle ? ` ${focusStyle}` : ''} />
          </div>
        `;
      } else if (ctx?.mode === 'edit') {
        // Editor canvas only: an image-less column is a legitimate layout, so
        // no placeholder ships to present/export - but in the editor an empty
        // slot must be clickable to add a FIRST image (media popover).
        imageHtml = `
          <div class="cc-image is-cover cc-image-placeholder is-empty" data-inline-photo="${colNum}" aria-hidden="true"></div>
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