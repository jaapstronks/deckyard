/**
 * Semantic text ROLE of a stylable field — the affordance model behind the
 * "This text" style controls (align / colour / size).
 *
 * The distinguishing axis for "which style options make sense here" is NOT the
 * field's data TYPE (a heading and a list item are both `type:'string'`) but
 * the field's MEANING / layout context. A list item sits next to a bullet or
 * number marker, so block alignment detaches its text from the marker; a
 * heading or a caption has no marker and aligns fine. So the capability lives
 * on the field's role, not its type.
 *
 * A field declares a `role` in its slide-type `fields[]` entry only when it
 * differs from the safe default (`prose`/`heading` — everything allowed); the
 * vast majority of fields stay implicit. `ROLE_AFFORDANCES` is the single
 * source both the editor (which controls to show) and the renderer (which
 * `tf-*` classes to emit) read.
 *
 * See docs/plans/text-role-affordances.md for the rollout (PR 1 tags list-item
 * fields; PR 2 rolls the vocabulary out and retires the quote hardcode).
 */

/** The controlled vocabulary of text roles. */
export const TEXT_ROLES = ['heading', 'prose', 'list-item', 'quote', 'caption', 'label'];

/** Default role for an untagged field: safe, all affordances allowed. */
export const DEFAULT_TEXT_ROLE = 'prose';

const ALL_ALIGNS = ['left', 'center', 'right'];

/**
 * role -> which style affordances the field offers.
 *   `align`: the allowed alignment VALUES (subset of left/center/right). `[]`
 *            means no alignment at all (marker-anchored text: the control is
 *            hidden and no `tf-align-*` class is emitted). Expressing align as a
 *            value set lets one table both hide alignment for list items AND
 *            drop `right` for a quote — no per-type hardcode.
 *   `color`/`size`: booleans (all roles allow them today; kept explicit so a
 *            future per-role difference is one table edit, not a new flag).
 *
 * A quote still permits left/center here AND the quote type additionally reads
 * its own align to centre the whole block — the two compose, so quote keeps the
 * generic classes (unlike list-item, which gets none).
 */
export const ROLE_AFFORDANCES = {
  heading: { align: ALL_ALIGNS, color: true, size: true },
  prose: { align: ALL_ALIGNS, color: true, size: true },
  'list-item': { align: [], color: true, size: true },
  quote: { align: ['left', 'center'], color: true, size: true },
  caption: { align: ALL_ALIGNS, color: true, size: true },
  label: { align: ALL_ALIGNS, color: true, size: true },
};

/**
 * The affordances for a role, falling back to the safe default for unknown or
 * absent roles.
 * @param {string} [role]
 * @returns {{align: string[], color: boolean, size: boolean}}
 */
export function roleAffordances(role) {
  return ROLE_AFFORDANCES[role] || ROLE_AFFORDANCES[DEFAULT_TEXT_ROLE];
}

/**
 * The alignment values a role permits (a subset of left/center/right; `[]` =
 * no alignment).
 * @param {string} [role]
 * @returns {string[]}
 */
export function allowedAlignValues(role) {
  return roleAffordances(role).align;
}

/**
 * Whether a role permits any block alignment (i.e. the alignment control is
 * shown at all). Roles with an empty align set do not.
 * @param {string} [role]
 * @returns {boolean}
 */
export function roleAllowsAlign(role) {
  return allowedAlignValues(role).length > 0;
}

/**
 * Resolve a `data-inline-field` key (possibly dotted, e.g. `items.0.text`)
 * against a slide type's `fields[]` declarations and return its declared role,
 * or the safe default. Numeric path segments descend into the preceding
 * `items` field's `itemFields`.
 * @param {Array<Object>} fields - a slide type's `fields` array
 * @param {string} key - the field key from `data-inline-field`
 * @returns {string} a role from TEXT_ROLES
 */
export function resolveFieldRole(fields, key) {
  if (!Array.isArray(fields) || !key) return DEFAULT_TEXT_ROLE;
  let defs = fields;
  let field = null;
  for (const part of String(key).split('.')) {
    if (/^\d+$/.test(part)) {
      // index into an `items` field -> descend into its itemFields
      defs = field && Array.isArray(field.itemFields) ? field.itemFields : [];
      continue;
    }
    field = Array.isArray(defs) ? defs.find((f) => f && f.key === part) : null;
    if (!field) return DEFAULT_TEXT_ROLE;
  }
  return (field && TEXT_ROLES.includes(field.role) && field.role) || DEFAULT_TEXT_ROLE;
}

/**
 * Convenience: whether a field key permits any block alignment, given its slide
 * type's `fields`. Used by the editor (whether to show the control at all).
 * @param {Array<Object>} fields
 * @param {string} key
 * @returns {boolean}
 */
export function fieldAllowsAlign(fields, key) {
  return roleAllowsAlign(resolveFieldRole(fields, key));
}

/**
 * The alignment values a field key permits, given its slide type's `fields`.
 * Used by the editor (which options to offer) and the renderer (which stored
 * align value may emit a `tf-align-*` class).
 * @param {Array<Object>} fields
 * @param {string} key
 * @returns {string[]}
 */
export function fieldAllowedAlignValues(fields, key) {
  return allowedAlignValues(resolveFieldRole(fields, key));
}
