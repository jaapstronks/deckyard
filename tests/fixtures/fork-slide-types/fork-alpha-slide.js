/**
 * Fork fixture A — the *minimal* file-based fork type.
 *
 * Loaded into the registry by the `test-fork` CI job (which copies this tree into
 * `custom/slide-types/` before `npm test`; see `.github/workflows/ci.yml`). It is
 * deliberately as bare as a real fork type tends to be: a label, a couple of
 * fields, and **no `inspectorKeeps`, no `inline` descriptor, no `structure`,
 * `runtime` or `fallback`**.
 *
 * That bareness is the whole point. A keepless type makes
 * `getInspectorKeepKeys()` take its fallback branch — every schema field minus
 * the inline-covered ones — which is the branch upstream never exercises because
 * every core type declares a keep-list. That branch also carries the injected
 * bg/a11y fields, which is the audit trap #501 fell into (fixed in #503). With
 * this file loaded, `tests/inspector-form.test.js` runs that branch for real.
 *
 * Keep the fields renderable-as-settings (string/enum, no `inline`): the audit
 * asserts every kept field surfaces somewhere in the inspector DOM, so a
 * bulk-modal-only field here would be a fixture bug, not a real finding.
 */

export default {
  label: 'Fork Alpha',
  fields: [
    { key: 'heading', type: 'string', label: 'Fork heading' },
    { key: 'accent', type: 'enum', label: 'Fork accent', options: ['calm', 'bold'] },
  ],
  defaults: { heading: '', accent: 'calm' },
};
