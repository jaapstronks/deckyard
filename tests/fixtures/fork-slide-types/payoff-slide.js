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
 * core.
 *
 * **It also carries the one real relative import in this fixture tree**, and
 * that is deliberate: `tests/custom-imports-resolvable.test.js` is the gate that
 * catches a fork whose imports into core stopped resolving after an upstream
 * reorganisation, and with import-free fixtures the fork lane never ran that
 * resolution on a single specifier. `escapeHtml` is what core's own
 * `payoff-slide` imports, so this is the realistic shape of the breakage as
 * well as a live exercise of the checker.
 *
 * The specifier is written for the file's *runtime* home, `custom/slide-types/`
 * (two levels below the repo root), not for its tracked home three levels down
 * here — hence the disable below. The fork CI lane copies this file into place
 * and resolves the import for real; that is where it is checked.
 */

// eslint-disable-next-line import-x/no-unresolved -- written for custom/slide-types/, see above
import { escapeHtml } from '../../shared/slide-types/helpers.js';

/** The marker the client render path proves it received (core emits `slide-payoff`). */
const PAYOFF_MARK = 'Fork payoff';

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
        <p class="fork-payoff-mark">${escapeHtml(PAYOFF_MARK)}</p>
      </div>
    </div>
  `,
};
