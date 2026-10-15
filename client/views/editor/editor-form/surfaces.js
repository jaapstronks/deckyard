/**
 * The surfaces the slide form renders on, as one declared table (D171).
 *
 * `createRerenderEditor` takes a surface name and reads capabilities from its
 * row; every part of the form that is not on every surface asks exactly one
 * capability. The form never branches on a surface's name, so a new surface is
 * a new row here, not a new boolean threaded through the render.
 *
 * - `fields`: `'keeps'` renders only the type's inspector keeps (content lives
 *   on the canvas and in the Fields form); `'content'` renders the per-type
 *   form without a single setting (`isSettingsField`, D335: content has two
 *   postures, a setting one home); `'all'` renders the full per-type form,
 *   settings included, for a surface with no inspector beside it.
 * - `toolbar`: the slide toolbar - type pill and retired/custom badges. (The
 *   Canvas | Fields tabs beside it are deck-editor chrome, built once by the
 *   controller, not per render.)
 * - `layout`: the Layout row at the top of the form (four schematics plus
 *   "All N →", B703 PR 3) for a type that declares `layoutVariants`.
 * - `typeConversion`: whether the Layout row may offer cross-type tiles
 *   (`convertTo`). Off where the slide's type is fixed: a library item's
 *   `slideType` is not writable (D170).
 * - `headerActions`: the chrome that belongs to the deck editor - the
 *   inspector's collapse control and the type pill's menu (Convert, AI
 *   Convert, View JSON). The slide actions live in the slide list.
 * - `deckTools`: everything that needs a saved deck around the slide - data
 *   source bar, per-slide duration, AI panels. (The chart-data entry point
 *   is on every surface: each host passes its own `onEditChartData`, D338.)
 * - `elementTabs`: the selection-aware [This element | Slide] tabs.
 * - `background`: the background colour group and image section.
 * - `a11y`: the Accessibility section. Off means an a11y key renders nowhere.
 */

/**
 * @typedef {object} SurfaceCapabilities
 * @property {'keeps'|'content'|'all'} fields
 * @property {boolean} toolbar
 * @property {boolean} layout
 * @property {boolean} typeConversion
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
    layout: true,
    typeConversion: true,
    headerActions: true,
    deckTools: true,
    elementTabs: true,
    background: true,
    a11y: true,
  }),
  // The Fields form in the canvas column (fields-view.js); the inspector
  // stands beside it, so it carries content only.
  bulk: Object.freeze({
    fields: 'content',
    toolbar: false,
    layout: false,
    typeConversion: false,
    headerActions: false,
    deckTools: false,
    elementTabs: false,
    background: false,
    a11y: false,
  }),
  library: Object.freeze({
    fields: 'all',
    toolbar: true,
    layout: true,
    typeConversion: false,
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
