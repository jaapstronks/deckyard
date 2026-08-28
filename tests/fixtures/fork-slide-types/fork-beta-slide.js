/**
 * Fork fixture B — a file-based fork type that ships its **own i18n keys**.
 *
 * Loaded by the `test-fork` CI job alongside fork fixture A (see
 * `fork-alpha-slide.js` and `.github/workflows/ci.yml`). Where A targets the
 * inspector audit, B targets the i18n prune (#499).
 *
 * Its `label`, field labels and placeholder generate a `slideType.fork-beta-slide.*`
 * namespace through `scripts/lib/slide-type-i18n-keys.js`, exactly as a core
 * type's copy does. `i18n:sync`'s prune deletes any `slideType.*` locale key the
 * registry no longer produces — and #499 was that prune deriving its valid set
 * with fork types *excluded* (copied from the since-retired `i18n-extract`, where
 * the skip was correct), so a fork's own translations looked orphaned and were
 * wiped. With this type loaded, `tests/fork-slide-type-derivations.test.js` asserts these
 * keys count as live in `liveSlideTypeI18nKeys()`, the exact set the prune uses.
 *
 * `fallback` makes it a well-behaved tier-3 type (a core-profile-only reader
 * degrades it to `content-slide`); nothing in the core suite requires it of a
 * fork, but a realistic fork declares one, and it exercises the wire path.
 */

export default {
  label: 'Fork Beta',
  fallback: 'content-slide',
  fields: [
    {
      key: 'forkNote',
      type: 'string',
      label: 'Fork note',
      placeholder: 'A note only this fork ships',
    },
    {
      key: 'forkTone',
      type: 'enum',
      label: 'Fork tone',
      options: ['plain', 'loud'],
    },
  ],
  defaults: { forkNote: '', forkTone: 'plain' },
  // See fork-alpha-slide.js: present because a type without `renderHtml` is a
  // type whose every slide renders the archived-slide placeholder.
  renderHtml: () => '<div class="slide slide-fork-beta"></div>',
};
