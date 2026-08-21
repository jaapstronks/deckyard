/**
 * Slide list: lock indicators are patched in place, not rebuilt.
 *
 * `onLocksChanged` used to answer every SSE lock echo with a blank
 * `rerenderSlideList()`, which re-renders every thumbnail just to move one
 * badge. `updateSlideLockIndicators(ids)` patches the affected rows instead.
 *
 * The regression risk is the badge lifecycle, so that is what this pins:
 * - a lock takes → the badge (and its collapsed-rail twin) appears on the
 *   right row, and the existing row elements survive (no rebuild);
 * - a lock releases → the badge disappears even though the caller only knows
 *   the *still-locked* ids, i.e. the stale row is re-checked;
 * - a legitimate full rerender still paints the badge, because both paths go
 *   through the same shared helper.
 *
 * Run with: node --test tests/slide-list-lock-indicator-patch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/p1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;

const { h } = await import('../client/lib/dom.js');
const { setupSlideList } = await import('../client/views/editor/slide-list.js');

const SLIDES = [
  { id: 's1', type: 'text-slide', content: { title: 'One' } },
  { id: 's2', type: 'text-slide', content: { title: 'Two' } },
  { id: 's3', type: 'text-slide', content: { title: 'Three' } },
];

/** Build a slide list wired to a mutable lock state. */
function makeList() {
  const slideListEl = h('div', { class: 'slide-list' });
  document.body.append(slideListEl);

  /** @type {Map<string, {holder: {id: string|null, displayName: string}}>} */
  const locks = new Map();
  let selectedSlideId = 's1';

  const api = setupSlideList({
    slideListEl,
    pres: { id: 'p1', slides: SLIDES.map((s) => ({ ...s })) },
    getSelectedSlideId: () => selectedSlideId,
    setSelectedSlideId: (id) => {
      selectedSlideId = id;
    },
    getSelectedSlideIds: () => new Set(),
    setSelectedSlideIds: () => {},
    clearMultiSelection: () => {},
    SLIDE_TYPES: [],
    renderSlideElement: () => h('div', { class: 'slide' }),
    editorState: {},
    markDirty: () => {},
    rerenderEditor: () => {},
    rerenderPreview: () => {},
    getSearchQuery: () => '',
    getSlideCommentCount: () => 0,
    getSlideLockInfo: (id) => locks.get(id) || null,
    isSlideLockedByOther: (id) => locks.has(id),
    isSlideAuthorLocked: () => false,
    isAuthor: () => true,
  });

  api.rerenderSlideList();
  return { api, slideListEl, locks, detach: () => slideListEl.remove() };
}

const row = (el, id) => el.querySelector(`.list-item[data-slide-id="${id}"]`);

test('a lock takes: the badge appears on that row without rebuilding the list', () => {
  const { api, slideListEl, locks, detach } = makeList();

  assert.equal(slideListEl.querySelectorAll('.slide-lock-indicator').length, 0);

  const rowsBefore = [...slideListEl.querySelectorAll('.list-item')];
  locks.set('s2', { holder: { id: 'user-other', displayName: 'Other' } });
  api.updateSlideLockIndicators(['s2']);

  const target = row(slideListEl, 's2');
  assert.ok(target.classList.contains('is-locked-by-other'), 'row is flagged');
  assert.equal(
    slideListEl.querySelectorAll('.slide-lock-indicator').length,
    1,
    'exactly one badge, on one row',
  );
  assert.ok(
    target.querySelector('.slide-lock-indicator'),
    'badge sits on the locked row',
  );
  assert.ok(
    target.querySelector('.slide-lock-indicator-collapsed'),
    'the collapsed-rail twin appears too',
  );
  assert.match(
    target.querySelector('.slide-lock-indicator').title,
    /Other/,
    'the holder is named in the tooltip',
  );

  const rowsAfter = [...slideListEl.querySelectorAll('.list-item')];
  assert.deepEqual(
    rowsAfter.map((el, i) => el === rowsBefore[i]),
    rowsAfter.map(() => true),
    'the existing row elements survive — the list was patched, not rebuilt',
  );

  detach();
});

test('a lock releases: the stale badge is cleared even though the caller only knows still-locked ids', () => {
  const { api, slideListEl, locks, detach } = makeList();

  locks.set('s2', { holder: { id: 'user-other', displayName: 'Other' } });
  api.updateSlideLockIndicators(['s2']);
  assert.equal(slideListEl.querySelectorAll('.slide-lock-indicator').length, 1);

  // The release: nothing is locked anymore, so the caller passes an empty set.
  locks.delete('s2');
  api.updateSlideLockIndicators([]);

  const target = row(slideListEl, 's2');
  assert.equal(
    slideListEl.querySelectorAll('.slide-lock-indicator').length,
    0,
    'the badge disappears',
  );
  assert.equal(
    slideListEl.querySelectorAll('.slide-lock-indicator-collapsed').length,
    0,
    'and so does the collapsed-rail twin',
  );
  assert.ok(
    !target.classList.contains('is-locked-by-other'),
    'the row flag is cleared',
  );
  assert.ok(
    target.querySelector('.thumb.thumb-mini .slide'),
    'the thumbnail is intact',
  );

  detach();
});

test('a legitimate full rerender still paints the badge', () => {
  const { api, slideListEl, locks, detach } = makeList();

  locks.set('s3', { holder: { id: 'user-other', displayName: 'Other' } });
  api.rerenderSlideList();

  const target = row(slideListEl, 's3');
  assert.ok(target.classList.contains('is-locked-by-other'));
  assert.ok(
    target.querySelector('.slide-lock-indicator'),
    'full render uses the same helper',
  );

  detach();
});
