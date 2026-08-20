/**
 * A7.15 PR C: the inspector's element tab asks the type, not a switch.
 *
 * `client/views/editor/editor-form/element-tab.js` answered "does this selected
 * canvas element get its own tab?" with `switch (slide.type)` over seven names —
 * pure per-type data (which sub-element kinds a type offers, and how many)
 * written as code, in the one place a new type would silently be missing from.
 *
 * The matrix below was written against that switch and passed before the
 * declaration existed, so it proves the move is equivalent rather than
 * describing what the new code happens to do. Every registered type is walked,
 * so a type that gains or loses an element kind has to come through here.
 *
 * Run with: node --test tests/element-tab-declaration.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { SLIDE_TYPES } = await import('../shared/slide-types.js');
const { elementAppliesToSlide } =
  await import('../client/views/editor/editor-form/element-tab.js');

/** Content rich enough that every collection has three items. */
function contentFor(type) {
  const content = structuredClone(SLIDE_TYPES[type]?.defaults || {});
  for (const key of ['images', 'members', 'logos', 'items']) {
    content[key] = [{}, {}, {}];
  }
  return content;
}

const applies = (type, sel, content) =>
  elementAppliesToSlide(
    { id: 's', type, content: content || contentFor(type) },
    sel,
    { slideTypes: SLIDE_TYPES },
  );

/**
 * The switch, restated as data: type -> kind -> the indices that get a tab,
 * probed over 0..3. Anything not named here offers no element tab at all.
 */
const EXPECTED = {
  'image-slide': { image: [0] },
  'image-text-slide': { image: [0, 1, 2, 3] }, // padded to the layout on demand
  'gallery-slide': { image: [0, 1, 2] }, // three items in the fixture
  'team-cards-slide': { image: [0, 1, 2] },
  'logo-wall-slide': { image: [0, 1, 2] },
  'quote-slide': { image: [1, 2, 3] }, // up to three author portraits
  'icon-card-grid-slide': { card: [0, 1, 2] },
};

test('every type offers exactly the element tabs it used to', () => {
  for (const type of Object.keys(SLIDE_TYPES)) {
    for (const kind of ['image', 'card']) {
      const expected = EXPECTED[type]?.[kind] || [];
      const actual = [0, 1, 2, 3].filter((idx) => applies(type, { kind, idx }));
      assert.deepEqual(
        actual,
        expected,
        `${type} / ${kind}: tab on indices ${actual.join(',') || '(none)'}`,
      );
    }
  }
});

test('a collection tab follows the collection length', () => {
  // gallery with one image: only index 0 has a tab. This is the half a flat
  // "this type has images" boolean could not express.
  const one = { ...contentFor('gallery-slide'), images: [{}] };
  assert.equal(applies('gallery-slide', { kind: 'image', idx: 0 }, one), true);
  assert.equal(applies('gallery-slide', { kind: 'image', idx: 1 }, one), false);

  const none = { ...contentFor('gallery-slide'), images: [] };
  assert.equal(
    applies('gallery-slide', { kind: 'image', idx: 0 }, none),
    false,
  );

  // …and a missing collection is not an array, which must not throw.
  const missing = { ...contentFor('team-cards-slide') };
  delete missing.members;
  assert.equal(
    applies('team-cards-slide', { kind: 'image', idx: 0 }, missing),
    false,
  );
});

test('text selection is type-independent — any named field is stylable', () => {
  for (const type of ['title-slide', 'chart-slide', 'poll-slide']) {
    assert.equal(applies(type, { kind: 'text', fieldKey: 'title' }), true);
    assert.equal(applies(type, { kind: 'text', fieldKey: '' }), false);
    assert.equal(applies(type, { kind: 'text' }), false);
  }
});

test('a missing slide or selection is not a tab', () => {
  assert.equal(elementAppliesToSlide(null, { kind: 'image', idx: 0 }), false);
  assert.equal(
    elementAppliesToSlide({ type: 'gallery-slide', content: {} }, null),
    false,
  );
  assert.equal(
    applies('gallery-slide', { kind: 'nonsense', idx: 0 }),
    false,
    'an unknown selection kind gets no tab',
  );
});
