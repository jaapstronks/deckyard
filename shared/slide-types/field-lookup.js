/**
 * Resolve a `data-inline-field` key against a slide type's `fields[]`.
 *
 * The key may be dotted (`items.0.text`, `rows.0.blocks.1.title`): a numeric
 * segment descends into the preceding collection field's `itemFields`. Both
 * affordance axes — the field's text ROLE (text-roles.js) and its GROUP
 * membership (field-groups.js) — need this same walk, so it lives here rather
 * than in either of them; that also keeps those two modules free of a cycle.
 */

/**
 * The field declaration a key points at, or null when the key does not resolve
 * against this schema.
 * @param {Array<Object>} fields - a slide type's `fields` array
 * @param {string} key - the field key from `data-inline-field`
 * @returns {Object|null}
 */
export function resolveFieldDef(fields, key) {
  if (!Array.isArray(fields) || !key) return null;
  let defs = fields;
  let field = null;
  for (const part of String(key).split('.')) {
    if (/^\d+$/.test(part)) {
      // index into a collection field -> descend into its itemFields
      defs = field && Array.isArray(field.itemFields) ? field.itemFields : [];
      continue;
    }
    field = Array.isArray(defs) ? defs.find((f) => f && f.key === part) : null;
    if (!field) return null;
  }
  return field;
}

/**
 * The text a type's `labelField` names for one slide: the field's value, or,
 * when the label driver is a collection (quote-slide's `quotes`), its first
 * item's `itemLabelField`. Empty string when there is none, so every consumer
 * falls through to its own fallbacks.
 * @param {Object} def - a slide type definition (or its editor metadata)
 * @param {Object} content - slide content
 * @returns {string}
 */
export function labelFieldText(def, content) {
  const key = typeof def?.labelField === 'string' ? def.labelField.trim() : '';
  if (!key) return '';
  const value = content?.[key];
  if (Array.isArray(value)) {
    const fields = Array.isArray(def.fields) ? def.fields : [];
    const sub = fields.find((f) => f?.key === key)?.itemLabelField;
    const text = typeof sub === 'string' ? value[0]?.[sub] : null;
    return typeof text === 'string' ? text.trim() : '';
  }
  return typeof value === 'string' ? value.trim() : '';
}
