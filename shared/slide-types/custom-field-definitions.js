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
 * ## What is this module, now that the walk is shared
 *
 * The structure rules themselves live in `field-definitions.js`, which
 * `validate-definition.js` runs too — one walk, one finding shape, no second
 * spelling of "an enum needs options" (B231). What stays here is what is
 * genuinely the database's: the narrowed type vocabulary, the row-sized bound,
 * a label the form insists on, and the **whitelist** — which properties survive
 * into storage, so a stored definition never keeps stray keys.
 *
 * That whitelist is why the A2 declarations (`mediaRef`, `itemLabelField`,
 * `foldUnofferedTo`) do not reach a DB type today: the shared walk checks them
 * wherever they appear, but the builder has no control that writes one, so
 * keeping them here would let the API accept a declaration the next Save drops.
 * They arrive when the builder offers them, not before.
 *
 * @see docs/developer/slide-types.md
 */

import { walkFieldDefinitions } from './field-definitions.js';

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
 * The rules this surface applies. `labelSeverity: 'error'` is the one place it
 * is stricter than the boot-time check: the inspector falls back to the key, so
 * a file-JS type without a label degrades, but for a DB type the label is the
 * only human name there is and the builder's form requires it.
 * @type {import('./field-definitions.js').FieldProfile}
 */
const DB_TYPE_PROFILE = {
  fieldTypes: CUSTOM_TYPE_FIELD_TYPES,
  maxFields: MAX_CUSTOM_TYPE_FIELDS,
  labelSeverity: 'error',
};

/**
 * @typedef {import('./field-definitions.js').FieldFinding} FieldDefinitionProblem
 * The first blocking finding of the shared walk. It is a
 * {@link import('./field-definitions.js').FieldFinding} and nothing more: the
 * builder opens `index` / `itemIndex`, prints `name`, and translates `code`.
 */

/** Properties a stored field definition keeps. Everything else is dropped. */
function cleanField(field) {
  const clean = {
    key: field.key.trim(),
    type: field.type.trim(),
    label: field.label.trim(),
  };
  if (field.required === true) clean.required = true;
  if (typeof field.maxLength === 'number' && field.maxLength > 0)
    clean.maxLength = field.maxLength;
  if (typeof field.placeholder === 'string')
    clean.placeholder = field.placeholder;
  if (typeof field.helpText === 'string') clean.helpText = field.helpText;
  if (clean.type === 'enum') clean.options = field.options;
  if (clean.type === 'items') {
    clean.itemFields = field.itemFields.map(cleanField);
    if (typeof field.minItems === 'number') clean.minItems = field.minItems;
    if (typeof field.maxItems === 'number') clean.maxItems = field.maxItems;
  }
  return clean;
}

/**
 * Validate and normalize a `fields[]` array.
 *
 * Returns the cleaned array on success — only the properties a type may carry
 * survive. On failure it returns the first blocking finding of the shared walk,
 * located precisely enough for a caller to point at the offending row. The walk
 * reports warnings too; this surface has one answer to give, so it acts on the
 * errors and leaves the rest to the boot-time report.
 *
 * @param {unknown} fields
 * @returns {{ok: true, fields: Array<Object>} | {ok: false, problem: FieldDefinitionProblem}}
 */
export function validateCustomFieldDefinitions(fields) {
  const { findings } = walkFieldDefinitions(fields, DB_TYPE_PROFILE);
  const problem = findings.find((f) => f.severity === 'error');
  if (problem) return { ok: false, problem };
  return { ok: true, fields: fields.map(cleanField) };
}
