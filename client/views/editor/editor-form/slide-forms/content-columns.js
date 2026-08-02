import { t } from '../../../../lib/ui-i18n.js';
import { createCollectionEditor } from '../collection-editor.js';
import {
  MAX_COLUMNS,
  MAX_TEXT_BLOCKS,
} from '../../../../../shared/slide-types/types/content-columns-slide.js';
import {
  ensureContentColumnsImages,
  CONTENT_COLUMNS_IMAGE_DEFAULTS,
} from '../../../../../shared/slide-types/types/content-columns-slide/images.js';

/**
 * DOCUMENTED EXCEPTION (archived type, numbered storage model).
 *
 * content-columns-slide is the one collection type without a canonical array:
 * its renderer, projection and inline editor all read the flat numbered
 * `col{n}*` fields, and the type is deprecated/archived, so it does not get
 * the array migration investment the live types got. Instead, this form runs
 * the generic collection editor on a TRANSIENT view model: `read` builds a
 * columns[] view from the numbered fields on every access, `write` folds each
 * mutation straight back into them. Nothing array-shaped is ever stored — the
 * numbered fields stay the single stored shape.
 *
 * This is the brief's fallback route ("shared machinery with per-type
 * config"), applied to exactly one archived type; every living collection
 * type runs schema-driven on the machinery itself.
 */

/** The columns[] view of the numbered fields (see module comment). */
function readColumns(content) {
  ensureContentColumnsImages(content);
  const count = Math.max(
    1,
    Math.min(MAX_COLUMNS, Number(content?.columnCount || 3) || 3)
  );
  const columns = [];
  for (let n = 1; n <= count; n += 1) {
    const blockCount = Math.max(
      0,
      Math.min(MAX_TEXT_BLOCKS, Number(content?.[`col${n}BlockCount`] || 0) || 0)
    );
    const blocks = [];
    for (let i = 1; i <= blockCount; i += 1) {
      blocks.push({
        title: content?.[`col${n}Block${i}Title`] || '',
        body: content?.[`col${n}Block${i}Body`] || '',
      });
    }
    columns.push({
      title: content?.[`col${n}Title`] || '',
      text: content?.[`col${n}Text`] || '',
      image: content?.[`col${n}Image`] || '',
      imageFit: content?.[`col${n}ImageFit`] || '',
      alt: content?.[`col${n}Alt`] || '',
      imageFocusX: content?.[`col${n}ImageFocusX`] ?? '',
      imageFocusY: content?.[`col${n}ImageFocusY`] ?? '',
      blocks,
    });
  }
  return columns;
}

/** Fold the columns[] view back into the numbered fields (full rewrite). */
function writeColumns(content, columns) {
  const count = Math.max(1, Math.min(MAX_COLUMNS, columns.length));
  content.columnCount = String(count);
  for (let n = 1; n <= MAX_COLUMNS; n += 1) {
    const col = n <= count ? columns[n - 1] || {} : null;
    content[`col${n}Title`] = col ? col.title || '' : '';
    content[`col${n}Text`] = col ? col.text || '' : '';
    content[`col${n}Image`] = col ? col.image || '' : '';
    content[`col${n}ImageFit`] = col ? col.imageFit || '' : '';
    content[`col${n}Alt`] = col ? col.alt || '' : '';
    content[`col${n}ImageFocusX`] = col ? col.imageFocusX ?? '' : '';
    content[`col${n}ImageFocusY`] = col ? col.imageFocusY ?? '' : '';
    const blocks = col && Array.isArray(col.blocks) ? col.blocks : [];
    content[`col${n}BlockCount`] = col ? String(Math.min(blocks.length, MAX_TEXT_BLOCKS)) : '0';
    for (let i = 1; i <= MAX_TEXT_BLOCKS; i += 1) {
      const b = i <= blocks.length ? blocks[i - 1] || {} : null;
      content[`col${n}Block${i}Title`] = b ? b.title || '' : '';
      content[`col${n}Block${i}Body`] = b ? b.body || '' : '';
    }
  }
}

/** The synthetic collection-field schema driving the generic editor. */
function columnsViewField() {
  return {
    key: 'columns',
    label: 'Columns',
    labelKey: 'editor.contentColumns.columnCount',
    minItems: 1,
    maxItems: MAX_COLUMNS,
    collapsible: true,
    itemDefaults: {
      title: '',
      text: '',
      image: '',
      imageFit: '',
      alt: '',
      blocks: [],
    },
    itemFields: [
      {
        key: 'title',
        type: 'string',
        label: 'Title',
        labelKey: 'editor.contentColumns.colTitle',
        maxLength: 80,
      },
      {
        key: 'text',
        type: 'markdown',
        label: 'Text (Markdown supported)',
        labelKey: 'editor.contentColumns.colText',
        maxLength: 500,
      },
      {
        key: 'image',
        type: 'image',
        label: 'Image',
        labelKey: 'editor.contentColumns.image',
      },
      {
        key: 'imageFit',
        type: 'enum',
        label: 'Image fit',
        labelKey: 'editor.contentColumns.imageFit',
        options: [
          {
            value: '',
            label: t('editor.imageText.fitDefaultType', 'Default · {fit}', {
              fit:
                CONTENT_COLUMNS_IMAGE_DEFAULTS.fit === 'contain'
                  ? t('editor.contentColumns.fitContain', 'Fixed height')
                  : t('editor.contentColumns.fitCover', 'Cropped (16:9)'),
            }),
          },
          { value: 'cover', label: t('editor.contentColumns.fitCover', 'Cropped (16:9)') },
          { value: 'contain', label: t('editor.contentColumns.fitContain', 'Fixed height') },
        ],
      },
      {
        key: 'alt',
        type: 'string',
        label: 'Alt text',
        labelKey: 'editor.contentColumns.altText',
        maxLength: 180,
      },
      {
        key: 'blocks',
        type: 'items',
        label: 'Text blocks',
        labelKey: 'editor.contentColumns.textBlocks',
        minItems: 0,
        maxItems: MAX_TEXT_BLOCKS,
        itemDefaults: { title: '', body: '' },
        itemFields: [
          {
            key: 'title',
            type: 'string',
            label: 'Title',
            labelKey: 'editor.contentColumns.blockTitle',
            maxLength: 80,
          },
          {
            key: 'body',
            type: 'markdown',
            label: 'Text',
            labelKey: 'editor.contentColumns.blockBody',
            maxLength: 500,
          },
        ],
      },
      // Focus (col{n}ImageFocusX/Y) is carried through the view model but not
      // rendered here: the canvas focus handle and the inspector's column
      // section already own it.
    ],
  };
}

export function renderContentColumnsForm({
  h,
  form,
  slide,
  def,
  add,
  used,
  fieldRenderers,
  deckSlides,
  markDirty,
  scheduleUiRefresh,
} = {}) {
  add('title');
  add('subheading');
  add('bottomSubheading');

  // Every numbered field is managed through the view model; none of them may
  // leak into the generic per-field loop.
  used.add('columnCount');
  for (let n = 1; n <= MAX_COLUMNS; n += 1) {
    for (const suffix of [
      'Title', 'Text', 'Image', 'ImageFit', 'ImageFocusX', 'ImageFocusY', 'Alt', 'BlockCount',
    ]) {
      used.add(`col${n}${suffix}`);
    }
    for (let i = 1; i <= MAX_TEXT_BLOCKS; i += 1) {
      used.add(`col${n}Block${i}Title`);
      used.add(`col${n}Block${i}Body`);
    }
  }

  form.append(
    createCollectionEditor({
      h,
      slide,
      def,
      field: columnsViewField(),
      fieldRenderers,
      deckSlides,
      markDirty,
      scheduleUiRefresh,
      model: {
        read: () => readColumns(slide.content),
        write: (arr) => writeColumns(slide.content, arr),
      },
    })
  );
}
