/**
 * Fork fixture C — an `override: true` of a CORE name (`payoff-slide`).
 *
 * Loaded by the `test-fork` CI job (copied into `custom/slide-types/` before
 * `npm test`; see `.github/workflows/ci.yml`). Where fixtures A and B take NEW
 * names — additive, already server-rendered — this one REPLACES a core type by
 * name, which is the case A7.10 is about: server-side the registry holds this
 * def (its `renderHtml`); client-side the browser bundles core's `payoff-slide`
 * under the same name. Without the fix the same slide showed core's markup in
 * the editor/presenter and this fork's markup only in exports.
 *
 * With this loaded, `OVERRIDDEN_CORE_SLIDE_TYPE_NAMES` lists `payoff-slide`, the
 * server injects it into `window.__DECK_SERVER_RENDERED_TYPES__`, and the client
 * routes it through server rendering — asserted by
 * `tests/fork-override-renderer-reach.test.js` (live half).
 *
 * DELIBERATELY metadata-identical to core `payoff-slide` (same `label`,
 * `structure`, `fallback`, `runtime`, empty `fields`) so it perturbs no
 * core-derived tracked artifact in the fork lane — the generated inventory doc,
 * the i18n key set, the inspector/structure/tier audits all see the same values
 * they see for core. The ONE thing that differs is `renderHtml`: it emits
 * `class="slide fork-payoff"` instead of core's `slide-payoff`, which is exactly
 * the split this item closes — the fork renderer that used to reach only exports
 * now reaches the browser too. `payoff-slide` is also one of the three core
 * names with no core inline descriptor (the brief's "row 3"), so the override is
 * server-rendered end to end with no core client renderer standing in.
 *
 * `override: true` is required or `mergeSlideTypes` refuses the shadow and keeps
 * core. Import-free, like the other fixtures.
 */

export default {
  override: true,
  overrides: 'core/payoff-slide',
  label: 'Payoff',
  structure: 'chrome',
  fallback: 'end-slide',
  runtime: 'static',
  fields: [],
  defaults: {},
  // The fork's own renderer — the whole point. `slide fork-payoff` is a marker
  // the client render path can prove it received (core emits `slide-payoff`).
  renderHtml: () => `
    <div class="slide fork-payoff">
      <div class="slide-inner">
        <p class="fork-payoff-mark">Fork payoff</p>
      </div>
    </div>
  `,
};
