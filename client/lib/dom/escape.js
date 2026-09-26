/**
 * The one Escape contract (B465, B471, B472): one press peels one layer.
 *
 * Every handler that acts on Escape goes through `takeEscape(e)`. It reads the
 * mark first — a layer that already acted on this press called
 * `preventDefault()`, so everyone after it leaves the key alone — and, when the
 * key is still free, marks it before the caller acts. There is no second form:
 * no `stopPropagation()` (it only silences the listeners further along one
 * path, and says nothing to a handler on the same node or in the other phase)
 * and no bare `e.key === 'Escape'` check that acts without reading or marking.
 * `tests/escape-contract-guard.test.js` pins both.
 *
 * Order decides who hears the key first, so it is part of the contract:
 *
 * - A control that owns the key (a search field, an in-place edit, an
 *   autocomplete) listens on itself; target listeners run before `document`.
 * - A transient layer opened on top of a standing surface (a menu, a popover, a
 *   drag in progress) listens on `document` or `window` in the **capture**
 *   phase, so it hears the key before the surface it sits on. The standing
 *   surface registered its bubble listener long before the layer opened and
 *   would otherwise go first.
 * - A standing surface (a drawer, a modal overlay, the presenter, the editor's
 *   selection) listens on `document` in the bubble phase and acts only on a
 *   press no layer took.
 *
 * Call it after the caller's own "am I open / is this mine" checks, so a
 * handler with nothing to close leaves the key to the next layer.
 *
 * @param {KeyboardEvent} e - The keydown event.
 * @returns {boolean} true when this handler now owns the press (and it is
 *   marked); false when it is not Escape or a layer already took it.
 */
export function takeEscape(e) {
  if (e?.key !== 'Escape' || e.defaultPrevented) return false;
  e.preventDefault();
  return true;
}
