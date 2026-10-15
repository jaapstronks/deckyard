/**
 * Which slide-type fields are SETTINGS rather than content (D335).
 *
 * Content has two working postures on the same fields, the canvas and the
 * Fields form; a setting has one home, the inspector. The Fields form may
 * therefore render no setting, and the rule that keeps it out has to be a
 * property of the schema, not a list per type, or a new type slips past it.
 *
 * The rule, stated once: a field is a setting when its value is a choice
 * rather than something a human wrote or picked as material - an `enum`, a
 * `boolean`, a `number`, a `color` or an `icon` - or when it declares a widget
 * that picks such a choice for it (`editor: 'icon-picker'` on a string holds an
 * icon name, `editor: 'image-fit'` a fit mode). Everything else (`string`,
 * `markdown`, `csv`, `image`, `url`, `email`, `items`) is content. These are
 * exactly the field types with no canvas affordance, which is why the parity
 * guard in `tests/slide-type-docs.test.js` reads the same list.
 *
 * Nested `items` follow the same rule per item field: `actions[].style` and
 * `rows[].arrow` are settings, `actions[].label` is content.
 *
 * @module shared/slide-types/settings-fields
 */

/** Field types whose value is a choice, not material. */
export const SETTINGS_FIELD_TYPES = Object.freeze([
  'enum',
  'boolean',
  'number',
  'color',
  'icon',
]);

/** Field editors (`field-editors.js`) that pick a setting for their field. */
const SETTINGS_EDITORS = new Set(['icon-picker', 'image-fit']);

const SETTINGS_TYPE_SET = new Set(SETTINGS_FIELD_TYPES);

/**
 * Whether a field descriptor (top-level or an `itemFields` entry) is a
 * setting.
 *
 * @param {Object} field - Field descriptor from a slide type's schema
 * @returns {boolean}
 */
export function isSettingsField(field) {
  if (!field) return false;
  if (SETTINGS_TYPE_SET.has(field.type)) return true;
  return SETTINGS_EDITORS.has(
    typeof field.editor === 'string' ? field.editor.trim() : '',
  );
}
