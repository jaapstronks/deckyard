/**
 * The deck lists page on the list-page contract in the client (B821).
 *
 * Home, Presentations and the trash used to receive every deck at once and
 * filter, count and sort them in the browser. They now ask the server for one
 * page at a time (`{ presentations, nextCursor }`) with the filters as query
 * parameters, and "Load more" reads the next page. This drives the real
 * `client/views/list/data.js` and `deck-pager.js` under jsdom against a
 * cursor-aware fake list:
 *
 *  - the query string carries ownership, visibility, one `tag` per tag, the
 *    limit and the cursor, and leaves out what is empty;
 *  - a deck the reader holds through a collaborator row is marked shared;
 *  - "Load more" shows only while there is a next page, reads it under the
 *    same filters and appends it;
 *  - a page of an old filter that arrives after a newer `load()` is dropped;
 *  - a failed "Load more" keeps the button for another try.
 *
 * Run with: node --test tests/deck-pager.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { fetchDeckPage } = await import('../client/views/list/data.js');
const { createDeckPager } = await import('../client/views/list/deck-pager.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A fake deck list of `count` decks behind a route-shaped `api`; the cursor is
 * the index of the next deck. Every request is recorded.
 * @param {number} count
 */
function deckList(count) {
  const decks = Array.from({ length: count }, (_, i) => ({
    id: `d${i}`,
    title: `Deck ${i}`,
  }));
  const requests = [];
  const api = async (path) => {
    const url = new URL(path, 'http://localhost');
    requests.push(url);
    const limit = Number(url.searchParams.get('limit'));
    const from = Number(url.searchParams.get('cursor') || 0);
    const page = decks.slice(from, from + limit);
    const next = from + limit < decks.length ? String(from + limit) : null;
    return { presentations: page, nextCursor: next };
  };
  return { api, requests };
}

test('the query string carries the filters and the page, nothing empty', async () => {
  const paths = [];
  const api = async (path) => {
    paths.push(path);
    return { presentations: [], nextCursor: null };
  };
  await fetchDeckPage(api, '/api/presentations');
  await fetchDeckPage(api, '/api/presentations', {
    ownership: 'all',
    visibility: 'organization',
    tags: ['Q3', 'board, final'],
    limit: 24,
    cursor: 'abc',
  });
  await fetchDeckPage(api, '/api/presentations', { tags: [], cursor: null });
  assert.deepEqual(paths, [
    '/api/presentations',
    '/api/presentations?ownership=all&visibility=organization&tag=Q3&tag=board%2C+final&limit=24&cursor=abc',
    '/api/presentations',
  ]);
});

test('a deck held through a collaborator row is marked shared', async () => {
  const api = async () => ({
    presentations: [{ id: 'own' }, { id: 'granted', permission: 'view' }],
    nextCursor: null,
  });
  const { decks, nextCursor } = await fetchDeckPage(api, '/api/presentations');
  assert.deepEqual(
    decks.map((d) => [d.id, d.isSharedWithMe]),
    [
      ['own', false],
      ['granted', true],
    ],
  );
  assert.equal(nextCursor, null);
});

test('"Load more" reads the next page under the same filters until the end', async () => {
  const { api, requests } = deckList(7);
  const shown = [];
  const pager = createDeckPager({
    api,
    path: '/api/presentations',
    limit: 3,
    onPage: (decks, { first }) => {
      if (first) shown.length = 0;
      shown.push(...decks.map((d) => d.id));
    },
  });
  document.body.append(pager.el);

  await pager.load({ ownership: 'owned', tags: ['Q3'] });
  assert.deepEqual(shown, ['d0', 'd1', 'd2']);
  assert.equal(pager.el.hidden, false, 'there is more');

  const button = pager.el.querySelector('button');
  button.click();
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(shown, ['d0', 'd1', 'd2', 'd3', 'd4', 'd5']);
  const second = requests[1].searchParams;
  assert.equal(second.get('ownership'), 'owned');
  assert.deepEqual(second.getAll('tag'), ['Q3']);
  assert.equal(second.get('cursor'), '3');

  button.click();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(shown.length, 7);
  assert.equal(pager.el.hidden, true, 'the end hides the button');
  assert.equal(pager.hasMore(), false);
  pager.el.remove();
});

test('a page of an old filter that lands after a newer load is dropped', async () => {
  let releaseOld;
  const api = async (path) => {
    const url = new URL(path, 'http://localhost');
    if (url.searchParams.get('ownership') === 'all') {
      await new Promise((resolve) => {
        releaseOld = resolve;
      });
      return { presentations: [{ id: 'stale' }], nextCursor: 'x' };
    }
    return { presentations: [{ id: 'fresh' }], nextCursor: null };
  };
  const pages = [];
  const pager = createDeckPager({
    api,
    path: '/api/presentations',
    onPage: (decks) => pages.push(decks.map((d) => d.id)),
  });

  const old = pager.load({ ownership: 'all' });
  await tick();
  await pager.load({ ownership: 'shared' });
  releaseOld();
  await old;
  assert.deepEqual(pages, [['fresh']]);
  assert.equal(pager.hasMore(), false, 'the stale cursor is not kept');
});

test('a failed "Load more" keeps the button for another try', async () => {
  const list = deckList(5);
  let fail = false;
  const api = async (path) => {
    if (fail) throw new Error('offline');
    return list.api(path);
  };
  const shown = [];
  const pager = createDeckPager({
    api,
    path: '/api/presentations/trash',
    limit: 2,
    onPage: (decks) => shown.push(...decks.map((d) => d.id)),
  });
  document.body.append(pager.el);
  await pager.load();

  fail = true;
  const button = pager.el.querySelector('button');
  button.click();
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(shown, ['d0', 'd1']);
  assert.equal(pager.el.hidden, false);
  assert.equal(button.disabled, false, 'the button is usable again');

  fail = false;
  button.click();
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(shown, ['d0', 'd1', 'd2', 'd3']);
  pager.el.remove();
});
