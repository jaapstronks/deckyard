/** Validate a write without making unchanged stored prose block other work. */
import { validateFieldValue } from './field-types.js';
import { isTextField } from './text-fields.js';

/**
 * Where a refusal sits inside one field, what kind of part it refuses and what
 * it says. An empty `path` is the field itself; otherwise it alternates item
 * index and sub-field key, `[1, 'linkedin']`, `[0, 'blocks', 2, 'body']` for a
 * list inside an item. `kind` is `'list'` when a list is refused as a list (not
 * an array, a count outside its limits, an item that is not an object), at any
 * depth, and `'value'` for one value; it comes from where the walk produced
 * the errors, never from the shape of the value.
 * @typedef {{path: Array<number|string>, kind: 'list'|'value', errors: string[]}} FieldPartProblem
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
    const problems = own.length
      ? [{ path: [], kind: 'list', errors: own }]
      : [];
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const before =
        previous?.[index] && typeof previous[index] === 'object'
          ? previous[index]
          : null;
      for (const child of field.itemFields || []) {
        const prefix = `Slide.content.${child.key}`;
        // A new item is checked as the list validator checks it: each
        // sub-field as one value, a list inside it included.
        const childProblems = before
          ? fieldChangeProblems(item[child.key], before[child.key], child)
          : [
              {
                path: [],
                kind: 'value',
                errors: validateFieldValue(item[child.key], child),
              },
            ];
        for (const { path, kind, errors } of childProblems) {
          if (!errors.length) continue;
          problems.push({
            path: [index, child.key, ...path],
            kind,
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
  if (!errors.length) return [];
  // A list that is not an array is refused as a list.
  return [
    { path: [], kind: field.type === 'items' ? 'list' : 'value', errors },
  ];
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
