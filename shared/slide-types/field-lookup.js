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
