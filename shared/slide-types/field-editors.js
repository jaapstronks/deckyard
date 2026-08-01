/**
 * Field EDITOR — which widget the editor uses to edit a field.
 *
 * The fourth declaration axis on a field, next to the text ROLE
 * (text-roles.js), the alignment GROUP (field-groups.js) and the form LAYOUT
 * (form-layout.js). Where `formLayout` says where a field sits in the form,
 * `editor` says what it is edited WITH: a field whose base widget (the one its
 * `type` implies — text input for `string`, enum select for `enum`, the
 * generic collection editor for `items`) is not the right tool declares a
 * richer one from this closed vocabulary.
 *
 * This is step 4 of the editor-behaviour-abstraction brief: the hand-built
 * per-type forms of category 3 ("real own tooling") were each one widget
 * wearing a whole form as a costume. The widget moves behind a vocabulary
 * name, the type declares the name on the field, and the form disappears —
 * "editor for field-kind Y" instead of "form of type X".
 *
 * Seam rules 4 and 5, unchanged: the VOCABULARY is closed (the editor decides
 * which widgets exist), the DECLARANT is open (any type, fork types included,
 * may declare any of them without touching a file outside its own directory),
 * and an unknown value degrades to the base widget for the field's `type`
 * rather than breaking.
 *
 * Not every widget resolves on every surface: the per-item loop of the
 * generic collection editor implements `icon-picker` and `card-link` (small,
 * item-sized widgets); the top-level field loop (render-field.js) implements
 * all of them. A name a surface has no rendering for degrades to the base
 * widget there — same rule as an unknown name.
 *
 * Declaration, JSON-safe so a fork overriding a type by name brings its own:
 *
 *   fields: [
 *     { key: 'rows', type: 'items', editor: 'table-grid', … },
 *   ]
 *   itemFields: [
 *     { key: 'icon', type: 'string', editor: 'icon-picker', … },
 *   ]
 */

/**
 * The widgets a field may declare.
 *
 * - `csv-grid`    — the spreadsheet-style data grid (chart data). Also the
 *                   base widget the `csv` field TYPE implies; the declaration
 *                   exists so a plain `string` field can opt in.
 * - `table-grid`  — the full table editor (cells, add/remove rows and
 *                   columns, markdown import/export, roomy modal) for an
 *                   `items` field whose items are the `c1…cN` cell shape.
 * - `icon-picker` — the icon search/picker modal for a `string` field
 *                   holding an icon name.
 * - `card-link`   — the slide-or-URL link picker for a `string` field
 *                   holding a card link.
 * - `image-fit`   — the cover/contain choice for an ImageRef `fit` field, with
 *                   the silent-default option: an extra empty choice labelled
 *                   with the value derived from the type's `imageDefaults.fit`,
 *                   which doubles as back-to-default by emptying the field.
 *                   The derived label is why this cannot be a plain `enum`:
 *                   the option text is a function of the declaring type's
 *                   config, not of the field.
 *
 * @type {readonly string[]}
 */
export const FIELD_EDITOR_VALUES = Object.freeze([
  'csv-grid',
  'table-grid',
  'icon-picker',
  'card-link',
  'image-fit',
]);

/**
 * A field's declared editor, or `''` when it declares none — which is also
 * what an unknown value resolves to, so a fork cannot land a widget name the
 * editor has no rendering for.
 *
 * @param {Object} field - one entry of a type's `fields[]` or `itemFields[]`
 * @returns {string} a value from FIELD_EDITOR_VALUES, or ''
 */
export function fieldEditor(field) {
  const name = typeof field?.editor === 'string' ? field.editor.trim() : '';
  return FIELD_EDITOR_VALUES.includes(name) ? name : '';
}
