/**
 * The slide library has its own address, and a slide's permalink opens that
 * slide (B285).
 *
 * Three things were wrong. Opening the library left the address on `/app`, so
 * there was nothing to bookmark or share. Closing a slide pushed `/app`, so
 * back from there re-opened the slide and the address said "home". And a
 * copied slide URL opened the library without the slide: `setView()` started
 * the library's first render, which began fetching the shelf; the permalink
 * then asked for the slide, `fetchShelf()` saw a fetch under way and returned
 * at once, and `openSlideById()` searched an empty shelf and gave up without a
 * word.
 *
 * These pin the cause (a second fetch of a shelf waits for the first) and the
 * three addresses: the library's, a slide's, and which one each tab and each
 * close writes.
 *
 * Run with: node --test tests/slide-library-permalink.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app?locale=nl',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;

const { route, slideLibraryPath, pushPath, replacePath, setRenderer } =
  await import('../client/lib/state/router.js');
const { addressForView } = await import('../client/views/list/view-routing.js');
const { createSlideLibraryApi } =
  await import('../client/views/slide-library/api.js');
const { createSlideLibraryState } =
  await import('../client/views/slide-library/state.js');

/** Point the live location at `path` without going through the router. */
function at(path) {
  dom.reconfigure({ url: `http://localhost${path}` });
}

// ------------------------------------------------------------------ routes

test('the bare library address is the library, not a deck called "slide-library"', () => {
  at('/app/slide-library');
  assert.deepEqual(route(), { name: 'slideLibrary' });
});

test("a slide's address names its shelf and id", () => {
  at('/app/slide-library/organization/abc-123');
  assert.deepEqual(route(), {
    name: 'slideLibrary',
    shelf: 'organization',
    slideId: 'abc-123',
  });
  at('/app/slide-library/personal/abc-123');
  assert.equal(route().shelf, 'personal');
});

test('slideLibraryPath builds what route() reads back', () => {
  assert.equal(slideLibraryPath(), '/app/slide-library');
  const path = slideLibraryPath('personal', 'id with/slash');
  assert.equal(path, '/app/slide-library/personal/id%20with%2Fslash');
  at(path);
  assert.equal(route().slideId, 'id with/slash');
});

test('a mangled escape keeps the raw id instead of throwing', () => {
  at('/app/slide-library/organization/%E0%A4%A');
  assert.equal(route().slideId, '%E0%A4%A');
});

test('a deck id under /app is still the editor', () => {
  at('/app/deck-1');
  assert.deepEqual(route(), { name: 'edit', id: 'deck-1' });
});

// ------------------------------------------------------- address writes

test('pushPath adds a history entry, replacePath does not; neither re-routes', () => {
  let renders = 0;
  setRenderer(() => renders++);
  at('/app/slide-library?locale=nl');
  const start = history.length;

  pushPath(slideLibraryPath('organization', 's1'));
  assert.equal(location.pathname, '/app/slide-library/organization/s1');
  assert.equal(location.search, '?locale=nl', 'the query stays');
  assert.equal(history.length, start + 1, 'opening a slide is a step back');

  replacePath(slideLibraryPath());
  assert.equal(location.pathname, '/app/slide-library');
  assert.equal(history.length, start + 1, 'closing it is not');

  pushPath(slideLibraryPath());
  assert.equal(history.length, start + 1, 'the current path is a no-op');
  assert.equal(renders, 0, 'the view already shows it: nothing re-renders');
});

test('each list tab names its address; search keeps the current one', () => {
  const list = { name: 'list' };
  const library = { name: 'slideLibrary' };
  const slide = { name: 'slideLibrary', shelf: 'personal', slideId: 's1' };

  assert.equal(addressForView('slideLibrary', list), '/app/slide-library');
  assert.equal(addressForView('slideLibrary', library), null);
  assert.equal(
    addressForView('slideLibrary', slide),
    null,
    'a permalink is already a library address',
  );
  assert.equal(addressForView('home', library), '/app');
  assert.equal(addressForView('trash', slide), '/app');
  assert.equal(addressForView('presentations', list), null);
  assert.equal(addressForView('search', library), null);
});

// ------------------------------------------------- the cause: the race

test('a second fetch of a loading shelf waits for the first (the B285 cause)', async () => {
  let calls = 0;
  let release;
  const api = () => {
    calls++;
    return new Promise((resolve) => {
      release = () => resolve({ items: [{ id: 's1' }] });
    });
  };
  const state = createSlideLibraryState({ initialShelf: 'organization' });
  const ops = createSlideLibraryApi({ api, state });

  // The first render starts the fetch; the permalink asks while it runs.
  const first = ops.fetchShelf('organization');
  let secondDone = false;
  const second = ops.fetchShelf('organization').then(() => (secondDone = true));

  await Promise.resolve();
  assert.equal(secondDone, false, 'the second caller does not return early');
  assert.equal(calls, 1, 'one request, shared');

  release();
  await Promise.all([first, second]);
  assert.deepEqual(
    state.getCache('organization').map((it) => it.id),
    ['s1'],
    'the permalink finds the slide once it resolves',
  );
  assert.equal(state.isLoading('organization'), false);

  const later = ops.fetchShelf('organization');
  assert.equal(calls, 2, 'a later fetch is a new request');
  release();
  await later;
});

test('a failed fetch frees the shelf for the next attempt', async () => {
  let calls = 0;
  const api = async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return { items: [] };
  };
  const state = createSlideLibraryState({});
  const ops = createSlideLibraryApi({ api, state });
  await assert.rejects(ops.fetchShelf('personal'), /offline/);
  assert.equal(state.isLoading('personal'), false);
  await ops.fetchShelf('personal');
  assert.equal(calls, 2);
});
