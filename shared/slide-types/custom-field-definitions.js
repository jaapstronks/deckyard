/**
 * The field-definition rules for a **database** custom slide type — the shape
 * the Settings > Slide Types builder authors and `POST /api/custom-slide-types`
 * stores.
 *
 * One rule set, two callers. The server refuses a definition that breaks these
 * rules (`server/storage/custom-slide-types.js`); the builder runs the same
 * check before it posts, so the person authoring the type is told which field is
 * wrong instead of watching Save do nothing. A second, client-only copy of the
 * rules is exactly the drift this module exists to prevent.
 *
 * ## Why the type list here is shorter than `FIELD_TYPES`
 *
 * `field-types.js` is the full registry every *file-JS* slide type may draw
 * from. A DB type is authored through a form, and only these six have an
 * authoring control in that form, so the storage layer accepts only these six.
 * The narrowing is deliberate and the builder's dropdown reads it from here.
 *
 * ## Relation to `validate-definition.js`
 *
 * That module validates a **file-JS** definition (an object with `renderHtml`,
 * `inline`, `ai`, …) and reports every finding at once for a boot-time log. This
 * one validates the portable `fields[]` of a DB type and stops at the first
 * problem, because its answer drives an accept/reject and a single inline error.
 * The two overlap on the field rules and disagree on nothing; folding them into
 * one walk needs a shared finding shape and is tracked separately.
 *
 * @see docs/developer/slide-types.md
 */

/**
 * The field types a database custom slide type may declare, in the order the
 * builder offers them.
 */
export const CUSTOM_TYPE_FIELD_TYPES = [
  'string',
  'markdown',
  'image',
  'images',
  'enum',
  'items',
];

/** Upper bound on `fields[]` (and on one `items` field's `itemFields[]`). */
export const MAX_CUSTOM_TYPE_FIELDS = 30;

/**
 * @typedef {object} FieldDefinitionProblem
 * @property {string} reason - Machine code; see {@link describeFieldProblem}.
 * @property {number|null} index - Index in `fields[]`, or null for a problem
 *   with the array itself.
 * @property {number|null} itemIndex - Index within that field's `itemFields[]`
 *   when the problem is nested, else null.
 * @property {string} where - Human location, e.g. `"Rows" > item field 2`.
 */

/**
 * Name a field the way a person authoring it would: its label, else its key,
 * else its position.
 * @param {unknown} field
 * @param {number} index
 * @returns {string}
 */
function fieldName(field, index) {
  const label = typeof field?.label === 'string' ? field.label.trim() : '';
  if (label) return `"${label}"`;
  const key = typeof field?.key === 'string' ? field.key.trim() : '';
  if (key) return `"${key}"`;
  return `field ${index + 1}`;
}

/**
 * Validate and normalize a `fields[]` array.
 *
 * Returns the cleaned array on success — only the properties a type may carry
 * survive, so a stored definition never keeps stray keys. On failure it returns
 * the first problem found, located precisely enough for a caller to point at the
 * offending row.
 *
 * @param {unknown} fields
 * @param {object} [options]
 * @param {string} [options.parentName] - Set when walking an `items` field's
 *   `itemFields[]`; used to build `problem.where`.
 * @returns {{ok: true, fields: Array<Object>} | {ok: false, problem: FieldDefinitionProblem}}
 */
export function validateCustomFieldDefinitions(fields, options = {}) {
  const parentName = options.parentName || '';
  const at = (index, itemIndex, name) => ({
    index,
    itemIndex,
    where: parentName ? `${parentName} › ${name}` : name,
  });

  if (!Array.isArray(fields)) {
    return {
      ok: false,
      problem: { reason: 'not_an_array', ...at(null, null, 'the field list') },
    };
  }
  if (fields.length > MAX_CUSTOM_TYPE_FIELDS) {
    return {
      ok: false,
      problem: { reason: 'too_many', ...at(null, null, 'the field list') },
    };
  }

  const validated = [];
  const keys = new Set();

  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    const name = fieldName(field, i);
    const fail = (reason) => ({
      ok: false,
      problem: { reason, ...at(i, null, name) },
    });

    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      return fail('not_an_object');
    }

    const key = String(field.key || '').trim();
    const type = String(field.type || '').trim();
    const label = String(field.label || '').trim();

    if (!key) return fail('missing_key');
    if (!label) return fail('missing_label');
    if (!type) return fail('missing_type');
    if (!CUSTOM_TYPE_FIELD_TYPES.includes(type)) return fail('unknown_type');
    if (keys.has(key)) return fail('duplicate_key');
    keys.add(key);

    const clean = { key, type, label };
    if (field.required === true) clean.required = true;
    if (typeof field.maxLength === 'number' && field.maxLength > 0)
      clean.maxLength = field.maxLength;
    if (typeof field.placeholder === 'string')
      clean.placeholder = field.placeholder;
    if (typeof field.helpText === 'string') clean.helpText = field.helpText;

    if (type === 'enum') {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        return fail('enum_without_options');
      }
      clean.options = field.options;
    }

    if (type === 'items') {
      if (!Array.isArray(field.itemFields) || field.itemFields.length === 0) {
        return fail('items_without_item_fields');
      }
      const sub = validateCustomFieldDefinitions(field.itemFields, {
        parentName: name,
      });
      if (!sub.ok) {
        // Re-anchor the nested problem on this row: the caller shows one
        // top-level list, and `itemIndex` is what tells it to open this row.
        return {
          ok: false,
          problem: {
            ...sub.problem,
            index: i,
            itemIndex: sub.problem.index,
          },
        };
      }
      clean.itemFields = sub.fields;
      if (typeof field.minItems === 'number') clean.minItems = field.minItems;
      if (typeof field.maxItems === 'number') clean.maxItems = field.maxItems;
    }

    validated.push(clean);
  }

  return { ok: true, fields: validated };
}

/**
 * The English sentence for a problem. The server answers with it (the API is
 * English-only); the builder maps `reason` to a translated string and falls back
 * to this, so the two never disagree about what went wrong.
 *
 * @param {FieldDefinitionProblem|null|undefined} problem
 * @returns {string}
 */
export function describeFieldProblem(problem) {
  const where = problem?.where || 'a field';
  switch (problem?.reason) {
    case 'not_an_array':
      return 'The field list must be an array.';
    case 'too_many':
      return `A slide type may have at most ${MAX_CUSTOM_TYPE_FIELDS} fields.`;
    case 'not_an_object':
      return `${where} is not a field definition.`;
    case 'missing_key':
      return `${where} has no key.`;
    case 'missing_label':
      return `${where} has no label.`;
    case 'missing_type':
      return `${where} has no type.`;
    case 'unknown_type':
      return `${where} has a type this builder does not offer — pick one of ${CUSTOM_TYPE_FIELD_TYPES.join(', ')}.`;
    case 'duplicate_key':
      return `${where} reuses a key another field already has.`;
    case 'enum_without_options':
      return `${where} is a dropdown with no options — add at least one.`;
    case 'items_without_item_fields':
      return `${where} is a repeater with no item fields — add at least one, so something describes the shape of an item.`;
    default:
      return 'Invalid field definitions.';
  }
}
