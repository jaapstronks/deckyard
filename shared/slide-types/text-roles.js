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

/**
 * role -> which style affordances the field offers.
 *   align: 'block' — block alignment is offered and rendered.
 *   align: 'start' — alignment forced to logical start; no control, no class
 *                    (marker-anchored text: bullets/numbers/steps).
 *   align: 'type'  — the slide type owns alignment itself (e.g. quote centres
 *                    the whole block); the generic control defers to it.
 * `color`/`size` are booleans (all roles allow them today; kept explicit so a
 * future per-role difference is one table edit, not a new flag).
 */
export const ROLE_AFFORDANCES = {
  heading: { align: 'block', color: true, size: true },
  prose: { align: 'block', color: true, size: true },
  'list-item': { align: 'start', color: true, size: true },
  quote: { align: 'type', color: true, size: true },
  caption: { align: 'block', color: true, size: true },
  label: { align: 'block', color: true, size: true },
};

/**
 * The affordances for a role, falling back to the safe default for unknown or
 * absent roles.
 * @param {string} [role]
 * @returns {{align: string, color: boolean, size: boolean}}
 */
export function roleAffordances(role) {
  return ROLE_AFFORDANCES[role] || ROLE_AFFORDANCES[DEFAULT_TEXT_ROLE];
}

/**
 * Whether a role permits block alignment (i.e. the alignment control is shown
 * and the `tf-align-*` class is emitted). `start`-aligned roles do not.
 * @param {string} [role]
 * @returns {boolean}
 */
export function roleAllowsAlign(role) {
  return roleAffordances(role).align !== 'start';
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
 * Convenience: whether a field key permits block alignment, given its slide
 * type's `fields`. Used by both the editor (hide the control) and the renderer
 * (drop the align class).
 * @param {Array<Object>} fields
 * @param {string} key
 * @returns {boolean}
 */
export function fieldAllowsAlign(fields, key) {
  return roleAllowsAlign(resolveFieldRole(fields, key));
}
