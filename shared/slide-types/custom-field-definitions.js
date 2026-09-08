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
 * a label the form insists on, and the **property vocabulary** a stored row may
 * spell.
 *
 * ## The vocabulary is a contract, not a filter (D84)
 *
 * It used to be a whitelist `cleanField` applied on the way to storage:
 * anything else fell out, silently. That is why the A2 declarations
 * (`itemLabelField`, `foldUnofferedTo`, `mediaRef`) could not reach a DB type —
 * the shared walk checked them wherever they appeared, but the next Save
 * dropped them again. They now have a control in the builder, so the vocabulary
 * carries them, and what it does not know it **refuses**: an unlisted property
 * is `unknown_property`, an error located on the row that declares it. Losing a
 * declaration on the way to disk is the same "truncated" this surface already
 * refuses for `usage`.
 *
 * The vocabulary is read per field type, because that is how it is authored: a
 * form with a control per row type. `options` belongs to an `enum` row and
 * `maxLength` to a text one, so either on the wrong row is a mistake with the
 * same answer as a property nothing has ever heard of. `cleanField` still trims
 * and normalizes; it no longer chooses.
 *
 * @see docs/developer/slide-types.md
 */

import { walkFieldDefinitions } from './field-definitions.js';
import { GLOBAL_SLIDE_FIELD_KEYS } from './compose.js';

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
 * Every property a stored field definition may carry, per field type. This is
 * the contract, so it is also the list the builder prunes a row to when its
 * type changes: a `maxLength` left behind by a string that became an enum would
 * otherwise be refused by a Save with no control on screen to clear it.
 * @type {import('./field-definitions.js').FieldPropertyVocabulary}
 */
export const CUSTOM_TYPE_PROPERTY_KEYS = Object.freeze({
  all: Object.freeze([
    'key',
    'type',
    'label',
    'required',
    'placeholder',
    'helpText',
  ]),
  byType: Object.freeze({
    string: Object.freeze(['maxLength', 'mediaRef']),
    markdown: Object.freeze(['maxLength']),
    enum: Object.freeze(['options', 'foldUnofferedTo']),
    items: Object.freeze([
      'itemFields',
      'minItems',
      'maxItems',
      'itemLabelField',
    ]),
  }),
});

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
  propertyKeys: CUSTOM_TYPE_PROPERTY_KEYS,
  // A stored `fields[]` is RAW: the registry appends the global slide fields
  // to it at runtime (`composeSlideType`), exactly as it does for a file-JS
  // type. Naming them here is what lets a `mediaRef.linkKey` point at
  // `slideBgImage` without a false "unknown key" warning, and what makes a row
  // that redeclares one of them say so.
  globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS,
};

/** True for a string with at least one non-space character. */
function isNonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Normalize one field definition for storage. Every property it reads is in the
 * vocabulary above — the walk has already refused anything else — so this trims
 * strings and drops values that say nothing (a `required: false`, an empty
 * `mediaRef.linkKey`), and decides nothing.
 */
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
  if (clean.type === 'enum') {
    clean.options = field.options;
    if (isNonEmpty(field.foldUnofferedTo))
      clean.foldUnofferedTo = field.foldUnofferedTo.trim();
  }
  if (clean.type === 'string' && field.mediaRef) {
    const ref = {};
    if (isNonEmpty(field.mediaRef.label))
      ref.label = field.mediaRef.label.trim();
    if (isNonEmpty(field.mediaRef.linkKey))
      ref.linkKey = field.mediaRef.linkKey.trim();
    clean.mediaRef = ref;
  }
  if (clean.type === 'items') {
    clean.itemFields = field.itemFields.map(cleanField);
    if (typeof field.minItems === 'number') clean.minItems = field.minItems;
    if (typeof field.maxItems === 'number') clean.maxItems = field.maxItems;
    if (isNonEmpty(field.itemLabelField))
      clean.itemLabelField = field.itemLabelField.trim();
  }
  return clean;
}

/**
 * Validate and normalize a `fields[]` array.
 *
 * Returns the cleaned array on success. On failure it returns the first
 * blocking finding of the shared walk, located precisely enough for a caller to
 * point at the offending row. The walk reports warnings too; this surface has
 * one answer to give, so it acts on the errors and leaves the rest to the
 * boot-time report.
 *
 * @param {unknown} fields
 * @returns {{ok: true, fields: Array<Object>} | {ok: false, problem: import('./field-definitions.js').FieldFinding}}
 *   On failure, the first blocking finding of the shared walk and nothing
 *   more: the builder opens `index` / `itemIndex`, prints `name`, and
 *   translates `code`.
 */
export function validateCustomFieldDefinitions(fields) {
  const { findings } = walkFieldDefinitions(fields, DB_TYPE_PROFILE);
  const problem = findings.find((f) => f.severity === 'error');
  if (problem) return { ok: false, problem };
  return { ok: true, fields: fields.map(cleanField) };
}
