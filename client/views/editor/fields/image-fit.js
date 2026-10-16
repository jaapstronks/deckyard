/**
 * The `image-fit` widget (field-editors.js vocabulary): the cover/contain
 * choice for an ImageRef `fit` field.
 *
 * What makes it a widget rather than a plain `enum`: for a type with a
 * type-level default (`imageDefaults.fit`), that option carries the default
 * mark and "Back to default" (D346), and choosing it empties the field
 * instead of writing the value. Empty is never stamped into the data, which is
 * what keeps a later default change reaching old decks
 * (docs/reference/image-property-ownership.md). Until D346 this was a third
 * "Default" option beside Fill and Fit; the mark replaces it.
 *
 * One module, three call sites: the top-level field loop (render-field.js),
 * the per-item loop of the generic collection editor (collection-editor.js)
 * and the shared "This image" element card (image-element-card.js) - so the
 * three surfaces cannot drift on what the default is.
 */
import { t } from '../../../lib/ui-i18n.js';

/**
 * The option list for a fit control: Fill and Fit.
 * @returns {Array<{value: string, label: string, title?: string}>}
 */
export function imageFitOptions() {
  return [
    {
      value: 'cover',
      label: t('editor.imageText.fitCover', 'Fill'),
      title: t(
        'editor.imageText.fitCoverTitle',
        'Fill the frame; the edges may be cropped',
      ),
    },
    {
      value: 'contain',
      label: t('editor.imageText.fitContain', 'Fit'),
      title: t(
        'editor.imageText.fitContainTitle',
        'Show the whole image; nothing is cropped',
      ),
    },
  ];
}

/**
 * Render a fit control for one `fit`-shaped key on a content-like object.
 *
 * @param {Object} o
 * @param {Function} o.fieldEnum - the enum field renderer
 * @param {Object} o.field - the schema field (for `key` and label lookup)
 * @param {Object} o.target - the object holding the value (slide content, or
 *   one images[] item)
 * @param {'cover'|'contain'|''} [o.typeDefault] - `imageDefaults.fit`, or empty
 *   for a type without a fit default (plain Fill / Fit, no mark)
 * @param {Function} o.onChange - called with the value to store: `''` when the
 *   choice equals the type default
 * @returns {HTMLElement|null}
 */
export function renderImageFitField({
  fieldEnum,
  field,
  target,
  typeDefault,
  onChange,
} = {}) {
  if (typeof fieldEnum !== 'function' || !field) return null;
  const hasDefault = typeDefault === 'cover' || typeDefault === 'contain';
  const raw = target?.[field.key];
  const current =
    raw === 'cover' || raw === 'contain'
      ? raw
      : hasDefault
        ? typeDefault
        : 'cover';
  return fieldEnum(
    {
      key: field.key,
      label: t(
        field.labelKey || field.key,
        field.label || t('editor.imageText.imageFit', 'Image fit'),
      ),
      options: imageFitOptions(),
    },
    current,
    (v) => onChange?.(hasDefault && v === typeDefault ? '' : v),
    { defaultValue: hasDefault ? typeDefault : undefined },
  );
}
