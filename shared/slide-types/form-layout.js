/**
 * Form LAYOUT — which fields the editor puts side by side on one row.
 *
 * The third declaration axis on a field, next to the text ROLE (text-roles.js)
 * and the alignment GROUP (field-groups.js). All three answer a different
 * question and stay separate vocabularies:
 *
 *   role        "what kind of text is this?"        intrinsic, closed set of six
 *   group       "which fields move together on      extrinsic, type-local, about
 *                the SLIDE?"                        the rendered slide
 *   formLayout  "which fields sit together in       extrinsic, type-local, about
 *                the EDITOR form?"                  the editing surface
 *
 * Why it exists: four slide types (title, content, list, kpi-metrics) used to
 * carry a hand-written editor form whose entire content was field order plus
 * "render these two side by side". Order already lives on the definition — it
 * is the order of `fields[]` — so the pairing was the only thing left, and a
 * ~127-line-per-type code branch is an expensive way to say it. Step 2 of the
 * editor-behaviour-abstraction brief replaces those forms with this hint.
 *
 * Seam rules 4 and 5, unchanged: the VOCABULARY is closed (the editor decides
 * which hints exist), the DECLARANT is open (any type, fork types included, may
 * use them), and an unknown value degrades to the default rather than breaking.
 * The default is one field per line — what every unannotated type already does.
 *
 * Deliberately NOT in this vocabulary: width. A field's natural minimum width
 * is a property of its editor widget, not of the type, and the renderers
 * already stamp it (`is-field-narrow|wide|full`, see
 * client/styles/base/03-controls-and-forms.css). `.field-grid` is flex-wrap, so
 * a row reflows on the real column width. A type declaring widths would be
 * declaring something it cannot know.
 *
 * Declaration, JSON-safe so a fork overriding a type by name brings its own:
 *
 *   fields: [
 *     { key: 'variant', type: 'enum', formLayout: 'pair', … },
 *     { key: 'layout',  type: 'enum', formLayout: 'pair', … },
 *   ],
 */

/**
 * The hints a field may declare. One for now — a run of consecutive `pair`
 * fields renders as one `.field-grid` row.
 *
 * `pair` is the honest name for what the four forms did (two small controls
 * that read as one choice), and a run of three behaves the same way, so a type
 * that wants three abreast is not blocked by the name.
 *
 * @type {readonly string[]}
 */
export const FORM_LAYOUT_VALUES = Object.freeze(['pair']);

/**
 * A field's declared form-layout hint, or `''` when it declares none — which is
 * also what an unknown value resolves to, so a fork cannot land a hint the
 * editor has no rendering for.
 *
 * @param {Object} field - one entry of a type's `fields[]`
 * @returns {string} a value from FORM_LAYOUT_VALUES, or ''
 */
export function fieldFormLayout(field) {
  const hint =
    typeof field?.formLayout === 'string' ? field.formLayout.trim() : '';
  return FORM_LAYOUT_VALUES.includes(hint) ? hint : '';
}

/**
 * Group a type's fields into the rows the editor renders them in: a maximal run
 * of consecutive `formLayout: 'pair'` fields becomes one row, every other field
 * stands on its own.
 *
 * Total and order-preserving — flattening the result's keys always reproduces
 * `fields[]` in definition order, which is what makes this safe to put in front
 * of both form loops (bulk modal and inspector). Rows are returned even when a
 * key will end up rendering nothing; the caller decides what to do with an empty
 * row, because only the caller knows which keys its surface gates out.
 *
 * @param {Array<Object>} fields - a slide type's `fields` array
 * @returns {Array<{ pair: boolean, keys: string[] }>}
 */
export function fieldFormRows(fields) {
  const rows = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    const key = typeof field?.key === 'string' ? field.key : '';
    if (!key) continue;
    const pair = fieldFormLayout(field) === 'pair';
    const last = rows[rows.length - 1];
    if (pair && last?.pair) {
      last.keys.push(key);
      continue;
    }
    rows.push({ pair, keys: [key] });
  }
  return rows;
}
