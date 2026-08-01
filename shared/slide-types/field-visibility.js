/**
 * Field VISIBILITY — when the editor shows a field at all.
 *
 * A declaration axis on a field, next to `formLayout` (form-layout.js) and
 * `editor` (field-editors.js). It answers "does editing this field mean
 * anything right now?": a chart's pie-label mode is dead UI on a bar chart,
 * axis labels do nothing on a pie. The per-type forms used to encode that as
 * imperative show/hide branches; the field now declares the condition and the
 * one generic form loop reads it — on both surfaces (bulk modal and
 * inspector), so the two cannot drift.
 *
 * The vocabulary is deliberately one operator:
 *
 *   { key: 'showValues', …, visibleWhen: { field: 'chartType', in: ['bar'] } }
 *
 * "Visible while sibling field <field> currently holds one of <in>." The
 * driving value is read from the slide's content, falling back to the type's
 * default when unset — the same resolution the renderer applies, so the form
 * and the slide agree on what is active.
 *
 * Seam rules 4 and 5: closed vocabulary (this module decides which operators
 * exist), open declarant (any type, forks included), and a malformed or
 * unknown declaration degrades to VISIBLE — hiding a field on a parse error
 * would orphan its data with no surface to edit it.
 *
 * Deliberately NOT here: `hidden: true` (a field that never renders — carried
 * data) and the inspector-keeps gating (which SURFACE owns a field). This axis
 * only says whether a field that would render is currently meaningful.
 */

/**
 * Whether a field is currently visible, per its `visibleWhen` declaration.
 *
 * @param {Object} field - one entry of a type's `fields[]`
 * @param {Object} [content] - the slide's content object
 * @param {Object} [defaults] - the type's `defaults` (fallback for unset keys)
 * @returns {boolean}
 */
export function isFieldVisible(field, content, defaults) {
  const cond = field?.visibleWhen;
  if (!cond || typeof cond !== 'object') return true;
  const key = typeof cond.field === 'string' ? cond.field.trim() : '';
  const list = Array.isArray(cond.in) ? cond.in : null;
  // Malformed declaration: degrade to visible, never orphan a field.
  if (!key || !list) return true;
  const raw = content?.[key];
  const value =
    raw == null || raw === ''
      ? String(defaults?.[key] ?? '')
      : String(raw);
  return list.some((v) => String(v) === value);
}
