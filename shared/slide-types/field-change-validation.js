/** Validate a write without making unchanged stored prose block other work. */
import { validateFieldValue } from './field-types.js';
import { isTextField } from './text-fields.js';

/**
 * Only an unchanged prose value may retain a missing/length quality defect.
 * Types, links, machine values and collection structure keep their validators.
 * Compare by declared path, never by matching an error's English sentence.
 * @param {unknown} value
 * @param {unknown} previous
 * @param {Object} field
 * @returns {string[]}
 */
export function validateFieldChange(value, previous, field) {
  if (field.type === 'items' && Array.isArray(value)) {
    const errors = validateFieldValue(value, { ...field, itemFields: [] });
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      for (const child of field.itemFields || []) {
        const prefix = `Slide.content.${child.key}`;
        errors.push(
          ...(previous?.[index] && typeof previous[index] === 'object'
            ? validateFieldChange(
                item[child.key],
                previous[index][child.key],
                child,
              )
            : validateFieldValue(item[child.key], child)
          ).map(
            (error) =>
              `Slide.content.${field.key}[${index}].${child.key}${error.slice(prefix.length)}`,
          ),
        );
      }
    });
    return errors;
  }
  const unchangedText =
    isTextField(field) &&
    value === previous &&
    (value == null || typeof value === 'string');
  return validateFieldValue(
    value,
    unchangedText ? { ...field, required: false, maxLength: undefined } : field,
  );
}
