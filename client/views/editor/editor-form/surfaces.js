/**
 * The surfaces the slide form renders on, as one declared table (D171).
 *
 * `createRerenderEditor` takes a surface name and reads capabilities from its
 * row; every part of the form that is not on every surface asks exactly one
 * capability. The form never branches on a surface's name, so a new surface is
 * a new row here, not a new boolean threaded through the render.
 *
 * - `fields`: `'keeps'` renders only the type's inspector keeps (content lives
 *   on the canvas and in the bulk modal); `'all'` renders the full per-type
 *   content form.
 * - `toolbar`: the slide toolbar - type pill, retired/custom badges, layout
 *   chip (and "All text" where the caller wires it).
 * - `headerActions`: the pane chrome that belongs to the deck editor - the
 *   inspector's collapse control and the slide-actions menu.
 * - `deckTools`: everything that needs a saved deck around the slide - data
 *   source bar, per-slide duration, AI panels, the chart-data entry point.
 * - `elementTabs`: the selection-aware [This element | Slide] tabs.
 * - `background`: the background colour group and image section.
 * - `a11y`: the Accessibility section. Off means an a11y key renders nowhere.
 */

/**
 * @typedef {object} SurfaceCapabilities
 * @property {'keeps'|'all'} fields
 * @property {boolean} toolbar
 * @property {boolean} headerActions
 * @property {boolean} deckTools
 * @property {boolean} elementTabs
 * @property {boolean} background
 * @property {boolean} a11y
 */

/** @type {Readonly<Record<string, Readonly<SurfaceCapabilities>>>} */
export const FORM_SURFACES = Object.freeze({
  inspector: Object.freeze({
    fields: 'keeps',
    toolbar: true,
    headerActions: true,
    deckTools: true,
    elementTabs: true,
    background: true,
    a11y: true,
  }),
  bulk: Object.freeze({
    fields: 'all',
    toolbar: false,
    headerActions: false,
    deckTools: false,
    elementTabs: false,
    background: false,
    a11y: false,
  }),
  library: Object.freeze({
    fields: 'all',
    toolbar: true,
    headerActions: false,
    deckTools: false,
    elementTabs: false,
    background: true,
    a11y: true,
  }),
});

/**
 * The capability row for a surface name. An unknown name is a programming
 * error and throws: silently falling back to a default surface would render a
 * form nobody declared.
 *
 * @param {string} surface
 * @returns {Readonly<SurfaceCapabilities>}
 */
export function surfaceCapabilities(surface) {
  const caps = Object.hasOwn(FORM_SURFACES, surface)
    ? FORM_SURFACES[surface]
    : null;
  if (!caps) throw new Error(`Unknown editor form surface: ${surface}`);
  return caps;
}
