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
 * The shelf is read page by page now (B822), so the permalink no longer
 * searches it: it reads the slide at its own address. These pin that, the
 * query a shelf page sends, and the three addresses: the library's, a
 * slide's, and which one each tab and each close writes.
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

// --------------------------------------- the cause, gone: no shelf to wait on

test('the permalink reads the slide at its own address, not out of a loading shelf (B285, B822)', async () => {
  // B285's cause was a race: the permalink searched a shelf whose first fetch
  // was still under way. The shelf is read page by page now (D358), so it is
  // never the whole shelf to search; the permalink asks for the one slide.
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path === '/api/slide-library/organization/s1') return { id: 's1' };
    throw Object.assign(new Error('Not found'), { status: 404 });
  };
  const state = createSlideLibraryState({ initialShelf: 'organization' });
  const ops = createSlideLibraryApi({ api, state });

  assert.deepEqual(await ops.fetchItem('organization', 's1'), { id: 's1' });
  assert.equal(
    await ops.fetchItem('personal', 's1'),
    null,
    'a slide that is not on that shelf answers null, so the host can say so',
  );
  assert.deepEqual(calls, [
    '/api/slide-library/organization/s1',
    '/api/slide-library/personal/s1',
  ]);
});

test('a shelf page carries its filters as query parameters and leaves out what is empty', async () => {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    return { items: [{ id: 's1' }], nextCursor: 'next' };
  };
  const state = createSlideLibraryState({});
  const ops = createSlideLibraryApi({ api, state, themeIdNorm: 'midnight' });

  const page = await ops.fetchPage(
    {
      shelf: 'organization',
      view: undefined,
      type: 'quote-slide',
      tags: ['intro', 'q3'],
      lang: 'nl',
      q: 'growth',
      limit: 30,
    },
    'c1',
  );
  assert.deepEqual(page, { items: [{ id: 's1' }], nextCursor: 'next' });
  const url = new URL(calls[0], 'http://localhost');
  assert.equal(url.pathname, '/api/slide-library/organization');
  assert.equal(url.searchParams.get('type'), 'quote-slide');
  assert.deepEqual(url.searchParams.getAll('tag'), ['intro', 'q3']);
  assert.equal(url.searchParams.get('lang'), 'nl');
  assert.equal(url.searchParams.get('q'), 'growth');
  assert.equal(url.searchParams.get('theme'), 'midnight');
  assert.equal(url.searchParams.get('limit'), '30');
  assert.equal(url.searchParams.get('cursor'), 'c1');
  assert.equal(url.searchParams.has('view'), false);

  await ops.fetchPage({ shelf: 'personal', view: 'trash' }, null);
  const trash = new URL(calls[1], 'http://localhost');
  assert.equal(trash.pathname, '/api/slide-library/personal');
  assert.equal(trash.searchParams.get('view'), 'trash');
  assert.equal(trash.searchParams.has('cursor'), false);
});
