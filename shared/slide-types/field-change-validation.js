/** Validate a write without making unchanged stored prose block other work. */
import { validateFieldValue } from './field-types.js';
import { isTextField } from './text-fields.js';

/**
 * Where a refusal sits inside one field, and what it says. An empty `path` is
 * the field itself (for a list: not an array, a count outside its limits, an
 * item that is not an object); otherwise it alternates item index and
 * sub-field key, `[1, 'linkedin']`, `[0, 'blocks', 2, 'body']` for a list
 * inside an item.
 * @typedef {{path: Array<number|string>, errors: string[]}} FieldPartProblem
 */

/**
 * {@link validateFieldChange} as data: the problems of one field with the path
 * each one sits at, so a caller can hold back one item's sub-field instead of
 * the whole list. The paths come from this walk, never from an error sentence.
 * @param {unknown} value
 * @param {unknown} previous - The stored value at the same place, if any.
 * @param {Object} field
 * @returns {FieldPartProblem[]}
 */
export function fieldChangeProblems(value, previous, field) {
  if (field.type === 'items' && Array.isArray(value)) {
    const own = validateFieldValue(value, { ...field, itemFields: [] });
    const problems = own.length ? [{ path: [], errors: own }] : [];
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const before =
        previous?.[index] && typeof previous[index] === 'object'
          ? previous[index]
          : null;
      for (const child of field.itemFields || []) {
        const prefix = `Slide.content.${child.key}`;
        const childProblems = before
          ? fieldChangeProblems(item[child.key], before[child.key], child)
          : [{ path: [], errors: validateFieldValue(item[child.key], child) }];
        for (const { path, errors } of childProblems) {
          if (!errors.length) continue;
          problems.push({
            path: [index, child.key, ...path],
            errors: errors.map(
              (error) =>
                `Slide.content.${field.key}[${index}].${child.key}${error.slice(prefix.length)}`,
            ),
          });
        }
      }
    });
    return problems;
  }
  const unchangedText =
    isTextField(field) &&
    value === previous &&
    (value == null || typeof value === 'string');
  const errors = validateFieldValue(
    value,
    unchangedText ? { ...field, required: false, maxLength: undefined } : field,
  );
  return errors.length ? [{ path: [], errors }] : [];
}

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
  return fieldChangeProblems(value, previous, field).flatMap((p) => p.errors);
}
