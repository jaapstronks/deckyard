/**
 * A fork override of a core name reaches the browser (A7.10).
 *
 * `custom/slide-types/*.js` may override a core type by name with
 * `override: true`. That replaced the whole definition — including `renderHtml`
 * — server-side, but the browser never saw it: `registry.js` loads the custom
 * loader behind `isNode`, and `custom/slide-types/` was not on the static
 * allowlist. So the same slide showed core's markup in the editor and presenter
 * and the fork's markup only in server-side exports (measured 2026-07-30; the
 * seam and its rule are documented in docs/reference/slide-type-directory.md).
 *
 * The fix routes such names through server-side rendering: the server names its
 * overrides (`OVERRIDDEN_CORE_SLIDE_TYPE_NAMES`) in a synchronous head global
 * (`window.__DECK_SERVER_RENDERED_TYPES__`), and the client's `needsServerRender`
 * reads it. This file proves each link.
 *
 * The synthetic half runs everywhere. The live half only means something with a
 * fork override actually in the registry, so it self-skips unless the
 * `title-slide` override fixture has been copied into `custom/slide-types/` —
 * which the `test-fork` CI job does. A local `npm test` runs the synthetic half.
 *
 * Run with: node --test tests/fork-override-renderer-reach.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  overriddenCoreNames,
  OVERRIDDEN_CORE_SLIDE_TYPE_NAMES,
  SLIDE_TYPES,
} from '../shared/slide-types/registry.js';
import {
  needsServerRender,
  isServerOverriddenType,
} from '../client/lib/slide-runtime/slide-render.js';

const OVERRIDE = 'payoff-slide';

/** True only when the override fork fixture has been loaded into the registry. */
const forkOverrideLoaded = OVERRIDDEN_CORE_SLIDE_TYPE_NAMES.includes(OVERRIDE);
const liveSkip = forkOverrideLoaded
  ? false
  : 'override fork fixture not loaded — this half runs in the `test-fork` CI ' +
    'job, which copies tests/fixtures/fork-slide-types/ into custom/slide-types/';

// ---------------------------------------------------------------------------
// Synthetic seam — always runs. The server's derivation of "which core names a
// fork overrode" reads the same rule mergeSlideTypes() enforces: a shadow
// counts only with override:true.
// ---------------------------------------------------------------------------

test('overriddenCoreNames flags an override:true collision, nothing else', () => {
  const core = { 'title-slide': {}, 'content-slide': {} };
  assert.deepEqual(
    overriddenCoreNames(core, { 'title-slide': { override: true } }),
    ['title-slide'],
    'a core name shadowed with override:true is an override',
  );
  assert.deepEqual(
    overriddenCoreNames(core, { 'content-slide': {} }),
    [],
    'a shadow WITHOUT override:true is refused by mergeSlideTypes, so it is not ' +
      'an override here either',
  );
  assert.deepEqual(
    overriddenCoreNames(core, { 'acme-hero': { override: true } }),
    [],
    'a NEW name is additive, not an override — it is unbundled and already ' +
      'server-rendered',
  );
});

test('the OSS registry overrides nothing', () => {
  // Only a fork populates this; upstream must stay empty so the head global and
  // its client branch are pure no-ops in the OSS build.
  if (forkOverrideLoaded) return; // the test-fork lane deliberately populates it
  assert.deepEqual(OVERRIDDEN_CORE_SLIDE_TYPE_NAMES, []);
});

// ---------------------------------------------------------------------------
// Client routing — always runs. The render path must send a bundled core name
// to the server whenever the head global lists it as a fork override, and leave
// every other name on the client.
// ---------------------------------------------------------------------------

test('needsServerRender routes a listed override to the server', () => {
  const prev = globalThis.window;
  const had = typeof prev !== 'undefined';
  try {
    globalThis.window = {
      ...(had ? prev : {}),
      __DECK_SERVER_RENDERED_TYPES__: ['title-slide'],
    };
    assert.equal(isServerOverriddenType('title-slide'), true);
    assert.equal(
      needsServerRender('title-slide'),
      true,
      'a bundled core name the server overrides is still drawn by the server',
    );
    assert.equal(
      needsServerRender('content-slide'),
      false,
      'a core name the fork did not override stays on the client',
    );
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
});

test('without the global, nothing is treated as an override', () => {
  const prev = globalThis.window;
  const had = typeof prev !== 'undefined';
  try {
    globalThis.window = { ...(had ? prev : {}) };
    delete globalThis.window.__DECK_SERVER_RENDERED_TYPES__;
    assert.equal(isServerOverriddenType('title-slide'), false);
    // Still bundled, so still client-rendered — the OSS behaviour.
    assert.equal(needsServerRender('title-slide'), false);
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
});

// ---------------------------------------------------------------------------
// Live seam — only with the override fork fixture loaded (the `test-fork` job).
// ---------------------------------------------------------------------------

test(
  'a loaded fork override is flagged in the registry and server-renders the fork markup',
  { skip: liveSkip },
  () => {
    // The whole point: with a real override on disk, the server registry both
    // holds the fork definition (its renderHtml) AND flags the name so the
    // browser is told to fetch it rather than draw core's markup.
    assert.ok(
      OVERRIDDEN_CORE_SLIDE_TYPE_NAMES.includes(OVERRIDE),
      `${OVERRIDE} must be flagged as a fork override`,
    );
    const markup = SLIDE_TYPES[OVERRIDE].renderHtml({}, { type: OVERRIDE }, {});
    assert.match(
      markup,
      /fork-payoff/,
      'server-side, the override renders the FORK markup — the same string every ' +
        'client context now receives once it routes through server rendering',
    );
    assert.doesNotMatch(
      markup,
      /payoff-logo/,
      "core's payoff markup must be gone: this is a replacement, not an " +
        "addition. The marker is core's logo image, not the `slide-payoff` " +
        'root class — an override keeps that, because it is the class every ' +
        "stylesheet for this slide role nests under (see the fixture's header).",
    );
  },
);
