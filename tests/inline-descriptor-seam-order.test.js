/**
 * `getInlineDescriptor()` resolves definition-first, like every companion.
 *
 * This lookup read the core map FIRST until mid-2026 — the aggregator-seam
 * rule's one documented exception — because a fork override of a CORE NAME
 * rendered core's markup in the browser: `custom/slide-types/` is loaded behind
 * `isNode` and was not on the static allowlist, so `isBundledSlideType()` found
 * core's entry and drew core's DOM. A descriptor describes the DOM, so it had to
 * follow the renderer, and the renderer was core's.
 *
 * That split is closed (docs/reference/slide-type-directory.md): the
 * server names its overrides in `window.__DECK_SERVER_RENDERED_TYPES__` and the
 * client routes them through server-side rendering, so an override now draws the
 * fork's markup in the browser too — the markup `def.inline` describes. The
 * lookup is now definition-first, and the premise test at the bottom is the one
 * that matters: it fails if that routing ever stops, which is the only thing
 * that made the flip safe.
 *
 * Run with: node --test tests/inline-descriptor-seam-order.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INLINE_DESCRIPTORS,
  getInlineDescriptor,
  getInlineFormTextKeys,
} from '../client/views/editor/inline-edit/descriptors.js';
import {
  needsServerRender,
  isServerOverriddenType,
} from '../client/lib/slide-runtime/slide-render.js';

/** A descriptor shaped like one a fork would declare on its definition. */
const FORK_DESCRIPTOR = {
  ghosts: [{ field: 'kicker', anchors: [{ sel: '.acme-headline', pos: 'before' }] }],
  formText: ['headline', 'kicker', 'sponsor'],
};

test('a fork override of a core name gets its OWN descriptor (definition-first)', () => {
  const type = 'title-slide';
  const core = INLINE_DESCRIPTORS[type];
  assert.ok(core, 'fixture assumes title-slide has a core descriptor');

  // The definition the editor holds is the /api/slide-types entry, which for an
  // override type carries the fork's `inline` verbatim. In the browser that
  // slide is now server-rendered from the fork's markup, so the fork's
  // descriptor is the one that matches the DOM.
  const def = { inline: FORK_DESCRIPTOR };

  assert.equal(
    getInlineDescriptor(type, def),
    FORK_DESCRIPTOR,
    'the fork markup is what the browser draws for an override, so the fork ' +
      'descriptor must win over core'
  );
  assert.deepEqual(getInlineFormTextKeys(type, def), FORK_DESCRIPTOR.formText);
});

test('a core type with no override falls through to the core descriptor', () => {
  // Core defs carry no `inline`, so definition-first resolves to the aggregator
  // entry — core's own markup, drawn by core's bundled renderer.
  const type = 'title-slide';
  const core = INLINE_DESCRIPTORS[type];
  assert.equal(getInlineDescriptor(type, { inline: undefined }), core);
  assert.equal(getInlineDescriptor(type, {}), core);
  assert.deepEqual(getInlineFormTextKeys(type, {}), core.formText);
});

test('a fork type with a new name still gets its own descriptor', () => {
  const def = { inline: FORK_DESCRIPTOR };
  assert.equal(
    getInlineDescriptor('acme-hero', def),
    FORK_DESCRIPTOR,
    'no core entry: the type is server-rendered from the fork markup this ' +
      'descriptor describes'
  );
  assert.deepEqual(getInlineFormTextKeys('acme-hero', def), FORK_DESCRIPTOR.formText);
});

test('a type nobody describes resolves to null, not a throw', () => {
  assert.equal(getInlineDescriptor('acme-hero', undefined), null);
  assert.equal(getInlineDescriptor('acme-hero', { inline: 'nope' }), null);
  assert.deepEqual(getInlineFormTextKeys('acme-hero', {}), []);
});

test('the premise: a fork override of a core name is routed to server rendering', () => {
  // Definition-first is only correct as long as an override's renderer reaches
  // the browser. The server signals that per name in a head global; the render
  // path reads it and forces server rendering even though the name is bundled.
  // If that ever stops, the browser draws core's markup again and def.inline
  // stops describing the DOM — so this is the load-bearing invariant.
  const hadWindow = typeof globalThis.window !== 'undefined';
  const prevWindow = globalThis.window;
  try {
    globalThis.window = {
      ...(hadWindow ? prevWindow : {}),
      __DECK_SERVER_RENDERED_TYPES__: ['title-slide'],
    };

    assert.equal(
      isServerOverriddenType('title-slide'),
      true,
      'the head global names title-slide as a fork override'
    );
    assert.equal(
      needsServerRender('title-slide'),
      true,
      'a bundled core name the server overrides must still be server-rendered, ' +
        'so the browser draws the fork markup def.inline describes'
    );
    assert.equal(
      needsServerRender('content-slide'),
      false,
      'a core name the fork did NOT override stays client-rendered'
    );
  } finally {
    if (hadWindow) globalThis.window = prevWindow;
    else delete globalThis.window;
  }
});
