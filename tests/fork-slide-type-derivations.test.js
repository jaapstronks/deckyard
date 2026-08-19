/**
 * The fork-loaded guardrail — the node half of B23.
 *
 * `custom/slide-types/` is gitignored, so upstream CI only ever runs the suite
 * against the core registry. A derivation that takes exactly one branch fewer for
 * a type that does NOT declare something is therefore structurally invisible here
 * — and that shape bit twice in two days, both times caught only at review:
 *
 *   - #499: `i18n:sync`'s orphan prune derived its valid-key set with fork types
 *     excluded (copied from the since-retired `i18n-extract`, where the skip was
 *     right — a shared extraction template must not carry a fork's strings), so it would
 *     have deleted a fork's own translations, and a core type's keys outright once
 *     a fork registered over its name with `override: true`.
 *   - #501 (→ #503): the inspector coverage audit asked every type for every
 *     keep-field, and the fallback branch of `getInspectorKeepKeys()` returns the
 *     nine globally-injected bg/a11y keys too. Every core type declares a keep
 *     list so upstream never takes that branch; a keepless file-based fork does.
 *
 * Two guardrails live here. The **synthetic** ones run everywhere (core CI too):
 * they pin the extract-vs-sync asymmetry at the library seam, where it is cheap
 * and deterministic. The **live** ones only mean anything with a fork type
 * actually in the registry, so they self-skip unless `tests/fixtures/
 * fork-slide-types/` has been copied into `custom/slide-types/` — which is what
 * the `test-fork` CI job does (see `.github/workflows/ci.yml`). A local `npm
 * test` runs the synthetic half and skips the live half.
 *
 * The #501 branch itself is audited by `tests/inspector-form.test.js` (it iterates
 * the live registry, so fork fixture A's keepless type exercises the fallback for
 * real); here we only assert that fixture reaches the branch, as a tripwire that
 * the fork fixtures are wired up the way that audit assumes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { slideTypeInspectorKeeps } from '../shared/slide-types/inline-edit-companions.js';
import { slideTypeUiKeys } from '../scripts/lib/slide-type-i18n-keys.js';
import { liveSlideTypeI18nKeys } from '../scripts/i18n-sync.js';

const ALPHA = 'fork-alpha-slide';
const BETA = 'fork-beta-slide';

/** True only when the fork fixtures have been loaded into the registry. */
const forkLoaded = Boolean(SLIDE_TYPES[ALPHA] && SLIDE_TYPES[BETA]);
const liveSkip = forkLoaded
  ? false
  : 'fork fixtures not loaded — this half runs in the `test-fork` CI job, which ' +
    'copies tests/fixtures/fork-slide-types/ into custom/slide-types/';

// ---------------------------------------------------------------------------
// Synthetic seam — always runs. #499 was a one-line choice at this seam: whether
// the i18n prune's valid-key derivation passes a fork skip-set. Both directions
// are pinned so a future edit that "tidies" sync to match extract fails loudly.
// ---------------------------------------------------------------------------

test('a fork type name contributes its own slideType.* i18n keys', () => {
  const registry = {
    'acme-hero-slide': {
      label: 'Hero',
      fields: [{ key: 'tagline', type: 'string', label: 'Tagline' }],
    },
  };
  const keys = slideTypeUiKeys(registry);
  assert.ok(keys.has('slideType.acme-hero-slide.label'), 'the type label is a key');
  assert.ok(
    keys.has('slideType.acme-hero-slide.field.tagline.label'),
    'the field label is a key'
  );
});

test('excluding a name drops ALL of its keys — the extract-only skip', () => {
  const registry = {
    'acme-hero-slide': {
      label: 'Hero',
      fields: [{ key: 'tagline', type: 'string', label: 'Tagline' }],
    },
  };
  const kept = slideTypeUiKeys(registry);
  const skipped = slideTypeUiKeys(registry, ['acme-hero-slide']);
  assert.ok(kept.has('slideType.acme-hero-slide.label'));
  assert.equal(
    skipped.has('slideType.acme-hero-slide.label'),
    false,
    'a skip-set removes the whole namespace — which is why an extraction step may ' +
      'pass one and the i18n-sync prune must not'
  );
});

test('an override of a core name is skipped WITH its core keys under a skip-set', () => {
  // The sharpest face of #499: once a fork registers `override: true` over a core
  // name, that name is in CUSTOM_SLIDE_TYPE_NAMES. A prune that fed that skip-set
  // to the derivation would treat the LIVE type's keys as
  // orphaned and delete the core translations wholesale. Modelled here so the
  // danger is a checked assertion, not only prose in i18n-sync.js.
  const registry = {
    'content-slide': {
      label: 'Forked content',
      fields: [{ key: 'body', type: 'markdown', label: 'Body' }],
    },
  };
  assert.ok(slideTypeUiKeys(registry).has('slideType.content-slide.label'));
  assert.equal(
    slideTypeUiKeys(registry, ['content-slide']).has('slideType.content-slide.label'),
    false
  );
});

// ---------------------------------------------------------------------------
// Live seam — only with the fork fixtures loaded (the `test-fork` job).
// ---------------------------------------------------------------------------

test(
  'the i18n prune keeps a loaded fork type\'s keys (guards #499)',
  { skip: liveSkip },
  () => {
    const valid = liveSlideTypeI18nKeys();
    for (const key of [
      `slideType.${BETA}.label`,
      `slideType.${BETA}.field.forkNote.label`,
      `slideType.${BETA}.field.forkNote.placeholder`,
      `slideType.${BETA}.field.forkTone.label`,
    ]) {
      assert.ok(
        valid.has(key),
        `${key} is a live fork key — the prune must not treat it as orphaned. ` +
          'If this fails, the sync valid-set has started excluding fork types (#499).'
      );
    }
  }
);

test(
  'the minimal fork type is keepless, so it reaches the inspector fallback (guards #501)',
  { skip: liveSkip },
  () => {
    // fixture A declares no inspectorKeeps and ships no inline descriptor, so the
    // keep-list resolver returns null and getInspectorKeepKeys falls back to
    // "every schema field" — the branch that carries the injected bg/a11y keys
    // tests/inspector-form.test.js audits. This is the tripwire that the fixture
    // is still shaped to exercise it.
    assert.equal(
      slideTypeInspectorKeeps(ALPHA, SLIDE_TYPES[ALPHA]),
      null,
      'fork fixture A must stay keepless — a keep-list here would skip the ' +
        'fallback branch and quietly defuse the #501 guardrail'
    );
  }
);
