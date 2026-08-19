/**
 * Field BEHAVIOUR — what the editor does with a field beyond rendering the
 * widget its `type` implies.
 *
 * The fifth declaration axis on a field, next to the text ROLE (text-roles.js),
 * the alignment GROUP (field-groups.js), the form LAYOUT (form-layout.js) and
 * the field EDITOR (field-editors.js). Where `editor` says *what a field is
 * edited with*, this one says what the editing surface does *around* that: an
 * extra control the widget offers, and what follows from a change to the value.
 *
 * Why it exists: `client/views/editor/editor-form/render-field.js` — the
 * generic field loop, the one module in the editor that must not know a type —
 * carried two per-type branches after every other per-type form had been
 * derived away. One decided which types get the markdown heading button, the
 * other which types auto-switch a heavily cropped image to `contain`. Both were
 * hard-coded lists of type names in a loop that is otherwise driven entirely by
 * `fields[]`, and both were on PR #451's list of things a type rename missed.
 *
 * Seam rules 4 and 5, unchanged: the VOCABULARY is closed (the editor decides
 * which behaviours exist), the DECLARANT is open (any type, fork types
 * included, may declare them without touching a file outside its own
 * directory), and an unknown value degrades to the default rather than
 * breaking. Both declarations are JSON-safe, so they survive the
 * `GET /api/slide-types` trip the editor reads its types from.
 *
 *   fields: [
 *     { key: 'body',  type: 'markdown', toolbar: ['heading'], … },
 *     { key: 'image', type: 'image', autoFit: { fit: 'fit' }, … },
 *   ]
 */

/**
 * Extra controls a field's base widget can be asked to offer.
 *
 * - `heading` — the markdown toolbar's heading button. Off by default because
 *   a heading inside a body is a layout decision most types do not want: the
 *   slide already renders a title, and a `##` in the body of a card or a
 *   comparison column competes with it. The two long-form prose bodies
 *   (content-slide, image-text-slide) do want it.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FIELD_TOOLBARS = Object.freeze({
  heading: 'The markdown toolbar heading button.',
});

/** @type {ReadonlyArray<string>} */
export const FIELD_TOOLBAR_NAMES = Object.freeze(Object.keys(FIELD_TOOLBARS));

/**
 * The extra controls a field declares, unknown names dropped. `[]` when it
 * declares none — which is the default for every field.
 *
 * @param {Object} field - one entry of a type's `fields[]` or `itemFields[]`
 * @returns {string[]}
 */
export function fieldToolbars(field) {
  const declared = field?.toolbar;
  if (!Array.isArray(declared)) return [];
  return declared.filter(
    (name) => typeof name === 'string' && Object.hasOwn(FIELD_TOOLBARS, name),
  );
}

/**
 * A field's auto-fit declaration: where the type keeps the fit that a picked
 * image, badly mismatched to its frame, should flip to `contain`.
 *
 * Shape (all keys optional except `fit`):
 *
 *   fit    — the slide-level content key holding the fit
 *   item   — `{ list, fit }` when the canonical fit lives on the first item of
 *            an ImageRef collection; `fit` above is then the pre-migration
 *            fallback sink, written when the collection is still empty
 *   legacy — `{ key, default }` for a superseded enum whose non-default value
 *            also counts as "the author already chose" (image-slide's `layout`)
 *
 * @param {Object} field - one entry of a type's `fields[]`
 * @returns {{fit: string, item?: {list: string, fit: string}, legacy?: {key: string, default: string}}|null}
 */
export function fieldAutoFit(field) {
  const d = field?.autoFit;
  if (!d || typeof d !== 'object' || typeof d.fit !== 'string' || !d.fit) {
    return null;
  }
  const out = { fit: d.fit };
  if (
    d.item &&
    typeof d.item === 'object' &&
    typeof d.item.list === 'string' &&
    typeof d.item.fit === 'string'
  ) {
    out.item = { list: d.item.list, fit: d.item.fit };
  }
  if (
    d.legacy &&
    typeof d.legacy === 'object' &&
    typeof d.legacy.key === 'string'
  ) {
    out.legacy = {
      key: d.legacy.key,
      default: typeof d.legacy.default === 'string' ? d.legacy.default : '',
    };
  }
  return out;
}

/**
 * Whether the author has already chosen a fit for this slide, in which case
 * auto-fit leaves it alone.
 *
 * Empty means "follow the type default" everywhere the ImageRef axes are
 * declared, so a non-empty value — cover included — is a choice. That is the
 * one behaviour this consolidation changed: the image-text branch used to
 * treat an explicit `cover` as unchosen and override it, while the image-slide
 * branch did not. Two rules for one question is the defect; respecting the
 * author is the rule that survives.
 *
 * @param {Object} content - the slide's content
 * @param {Object} decl - a resolved {@link fieldAutoFit} declaration
 * @returns {boolean}
 */
function hasChosenFit(content, decl) {
  const c = content && typeof content === 'object' ? content : {};
  if (decl.item) {
    const items = Array.isArray(c[decl.item.list]) ? c[decl.item.list] : [];
    const first = items[0] && typeof items[0] === 'object' ? items[0] : null;
    return Boolean(first?.[decl.item.fit] || c[decl.fit]);
  }
  if (c[decl.fit]) return true;
  if (decl.legacy) {
    const legacy = c[decl.legacy.key];
    if (legacy && legacy !== decl.legacy.default) return true;
  }
  return false;
}

/**
 * Switch this slide's image fit to `contain`, unless the author already chose
 * one. Mutates `content`.
 *
 * @param {Object} content - the slide's content
 * @param {Object|null} decl - a resolved {@link fieldAutoFit} declaration
 * @returns {boolean} whether anything was written
 */
export function applyAutoContainFit(content, decl) {
  if (!decl || !content || typeof content !== 'object') return false;
  if (hasChosenFit(content, decl)) return false;

  if (decl.item) {
    const items = Array.isArray(content[decl.item.list])
      ? content[decl.item.list]
      : [];
    const first = items[0] && typeof items[0] === 'object' ? items[0] : null;
    // The legacy flat `image` field can fire this before the migration into
    // items[] has happened; then write the slide-level sink, which the next
    // edit folds into the item.
    if (first) first[decl.item.fit] = 'contain';
    else content[decl.fit] = 'contain';
    return true;
  }

  content[decl.fit] = 'contain';
  return true;
}
