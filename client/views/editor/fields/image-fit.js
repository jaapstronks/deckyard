/**
 * The `image-fit` widget (field-editors.js vocabulary): the cover/contain
 * choice for an ImageRef `fit` field.
 *
 * What makes it a widget rather than a plain `enum`: the empty option says
 * "Default" and its title what that resolves to under the declaring type's
 * `imageDefaults.fit` config, and it doubles as back-to-default by emptying
 * the field. Its label never repeats a real option's label (B457: "Default ·
 * Fill (crop)" beside "Fill (crop)" read as the same button twice). Empty is
 * never stamped into the data, which is what keeps a later default change
 * reaching old decks (docs/reference/image-property-ownership.md).
 *
 * One module, three call sites: the top-level field loop (render-field.js),
 * the per-item loop of the generic collection editor (collection-editor.js)
 * and the shared "This image" element card (image-element-card.js) — so the
 * three surfaces cannot drift on what the default option says.
 */
import { t } from '../../../lib/ui-i18n.js';

/**
 * The option list for a fit control.
 *
 * @param {Object} [o]
 * @param {'cover'|'contain'} [o.typeDefault] - the type's `imageDefaults.fit`.
 *   Omit (or pass a falsy value) for a control WITHOUT the silent-default
 *   option: types whose fit has no type-level default get plain Fill / Fit.
 * @returns {Array<{value: string, label: string, title?: string}>}
 */
export function imageFitOptions({ typeDefault } = {}) {
  const coverTitle = t(
    'editor.imageText.fitCoverTitle',
    'Fill the frame; the edges may be cropped',
  );
  const containTitle = t(
    'editor.imageText.fitContainTitle',
    'Show the whole image; nothing is cropped',
  );
  const coverLabel = t('editor.imageText.fitCover', 'Fill');
  const containLabel = t('editor.imageText.fitContain', 'Fit');
  const options = [
    {
      value: 'cover',
      label: coverLabel,
      title: coverTitle,
    },
    {
      value: 'contain',
      label: containLabel,
      title: containTitle,
    },
  ];
  if (typeDefault !== 'cover' && typeDefault !== 'contain') return options;
  return [
    {
      value: '',
      label: t('editor.imageText.fitDefaultType', 'Default'),
      title: t(
        'editor.imageText.fitDefaultTypeTitle',
        'Follow the slide type default: {fit}',
        { fit: typeDefault === 'contain' ? containLabel : coverLabel },
      ),
    },
    ...options,
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
 *   for a control without the silent-default option
 * @param {Function} o.onChange - called with the new value
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
    raw === 'cover' || raw === 'contain' ? raw : hasDefault ? '' : 'cover';
  return fieldEnum(
    {
      key: field.key,
      label: t(
        field.labelKey || field.key,
        field.label || t('editor.imageText.imageFit', 'Image fit'),
      ),
      options: imageFitOptions({ typeDefault }),
    },
    current,
    onChange,
  );
}
