/**
 * `getInlineDescriptor()` resolves core-map-first on purpose.
 *
 * Every other companion in this family resolves definition-first — the
 * aggregator-seam rule in docs/reference/slide-type-directory.md. This lookup
 * is the one documented exception, and it has been logged as drift twice, so
 * the reasoning is pinned here rather than left to a comment.
 *
 * A descriptor is a description of the DOM, not a fact about the type: it names
 * selectors and `data-inline-field` paths that some renderer emitted. So it has
 * to follow the renderer, and in the browser the renderer for a fork type that
 * overrides a CORE NAME is still core's — `custom/slide-types/` is loaded
 * behind `isNode` and is not on the static allowlist, so `isBundledSlideType()`
 * in client/lib/slide-runtime/slide-render.js finds core's entry and renders
 * core's markup. Measured: with the fork's descriptor, 0 of 2 ghost anchors
 * resolve against that DOM; with core's, 2 of 2.
 *
 * A fork type with a NEW name is not bundled, is server-rendered from the
 * fork's own markup, and has no core entry — so the fallback fires and the seam
 * works exactly where the fork's renderer is the one that drew the slide.
 *
 * The premise test at the bottom is the one that matters: core-map-first is
 * only the same thing as renderer-first as long as every type in the core
 * descriptor map is bundled client-side. If that ever stops holding, the
 * exception loses its justification and this test says so.
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
import { SLIDE_TYPES } from '../shared/slide-types.js';

/** A descriptor shaped like one a fork would declare on its definition. */
const FORK_DESCRIPTOR = {
  ghosts: [{ field: 'kicker', anchors: [{ sel: '.acme-headline', pos: 'before' }] }],
  formText: ['headline', 'kicker', 'sponsor'],
};

test('a fork override of a core name does NOT displace the core descriptor', () => {
  const type = 'title-slide';
  const core = INLINE_DESCRIPTORS[type];
  assert.ok(core, 'fixture assumes title-slide has a core descriptor');

  // The definition the editor holds is the /api/slide-types entry, which for an
  // override type carries the fork's `inline` verbatim.
  const def = { inline: FORK_DESCRIPTOR };

  assert.equal(
    getInlineDescriptor(type, def),
    core,
    'core wins: the browser renders core markup for a bundled name, so the ' +
      'descriptor must describe core markup'
  );
  assert.deepEqual(
    getInlineFormTextKeys(type, def),
    core.formText,
    'the inspector must be told what the canvas can actually edit'
  );
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

test('the premise: every core descriptor belongs to a type the client bundles', () => {
  // If a descriptor ever lands on a type the browser cannot render itself, that
  // type is server-rendered — and then core-map-first stops meaning
  // renderer-first, which is the entire justification for the exception.
  const unbundled = Object.keys(INLINE_DESCRIPTORS).filter(
    (type) => typeof SLIDE_TYPES[type]?.renderHtml !== 'function'
  );
  assert.deepEqual(
    unbundled,
    [],
    'these types have a core descriptor but no client-side renderer, so the ' +
      'core-first exception no longer holds for them — see ' +
      'docs/reference/slide-type-directory.md, "The one exception"'
  );
});
