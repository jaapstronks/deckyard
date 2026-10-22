/**
 * The notification bell pages its list by cursor (B819, D358).
 *
 * This drives the real component under jsdom against an in-memory inbox that
 * answers like the route: `limit` rows of the requested lens after `cursor`,
 * with a `nextCursor` while more remain. It pins what the contract tests on
 * the server cannot see:
 *
 *   1. **Load more walks the lens to its end** and then disappears.
 *   2. **A lens switch starts over**: the first page of the new lens, no
 *      cursor carried across.
 *   3. **Archiving the page shown does not end the list.** With 21 rows,
 *      archiving the first 20 one by one fetches the 21st; only archiving
 *      that one too shows the empty state. A failed fetch at that point keeps
 *      Load more on screen instead of claiming the inbox is empty.
 *   4. **Archive all wins over a page still under way.** A Load more answer
 *      read before the mutation does not put archived rows or their cursor
 *      back; a lens switch during the mutation reads its lens again.
 *
 * Run with: node --test tests/notification-bell-paging.test.js
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
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
// The bell opens a live stream; the paging under test never needs an event.
globalThis.EventSource = class {
  addEventListener() {}
  removeEventListener() {}
  close() {}
};

const { createNotificationBell } =
  await import('../client/views/user/notification-bell.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Let every pending request and its render settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

/**
 * An inbox of `count` read notifications behind a route-shaped fake `api`.
 * The cursor is the id of the last row handed out, so archiving rows already
 * shown does not move the position, as with the keyset cursor.
 * @param {number} count
 */
function createInbox(count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    title: `Notification ${i}`,
    isRead: true,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  }));
  const pageRequests = [];
  let failNextPage = false;
  let holdNextPage = null;
  let holdNextArchive = null;

  function inLens(row, filter) {
    if (filter === 'archived') return Boolean(row.archivedAt);
    if (row.archivedAt) return false;
    return filter === 'all' || (filter === 'unread' && !row.isRead);
  }

  async function api(url, opts = {}) {
    const { pathname, searchParams } = new URL(url, 'http://localhost');
    if (pathname === '/api/notifications/unread-count') {
      return { unreadCount: 0 };
    }
    if (pathname === '/api/notifications/archive') {
      if (holdNextArchive) {
        const gate = holdNextArchive;
        holdNextArchive = null;
        await gate;
      }
      const now = new Date().toISOString();
      if (opts.body.all) {
        for (const row of rows) row.archivedAt ??= now;
      } else {
        rows.find((n) => n.id === opts.body.notificationId).archivedAt = now;
      }
      return { ok: true };
    }
    assert.equal(pathname, '/api/notifications');
    const filter = searchParams.get('filter');
    const cursor = searchParams.get('cursor');
    const limit = Number(searchParams.get('limit'));
    pageRequests.push({ filter, cursor });
    if (failNextPage) {
      failNextPage = false;
      throw new Error('network down');
    }
    const start = cursor ? rows.findIndex((n) => n.id === cursor) + 1 : 0;
    const rest = rows.slice(start).filter((n) => inLens(n, filter));
    const page = rest.slice(0, limit).map((n) => ({ ...n }));
    const resp = {
      notifications: page,
      nextCursor: rest.length > limit ? page.at(-1).id : null,
      unreadCount: 0,
    };
    // A held page is read now and answered later, like a slow response.
    if (holdNextPage) {
      const gate = holdNextPage;
      holdNextPage = null;
      await gate;
    }
    return resp;
  }

  /** Hold the next request of a kind; the returned function releases it. */
  function hold(set) {
    let release;
    set(new Promise((resolve) => (release = resolve)));
    return () => release();
  }

  return {
    api,
    pageRequests,
    failNextPage: () => {
      failNextPage = true;
    },
    holdNextPage: () => hold((gate) => (holdNextPage = gate)),
    holdNextArchive: () => hold((gate) => (holdNextArchive = gate)),
    remaining: () => rows.filter((n) => !n.archivedAt).length,
  };
}

async function openBell(inbox) {
  const bell = createNotificationBell({ api: inbox.api });
  document.body.append(bell.el);
  bell.el.querySelector('.notification-bell-btn').click();
  await settle();
  return bell;
}

function view(bell) {
  const loadMore = bell.el.querySelector('.notification-bell-load-more');
  return {
    titles: [...bell.el.querySelectorAll('.notification-bell-item-title')].map(
      (el) => el.textContent,
    ),
    loadMore: Boolean(loadMore),
    empty: Boolean(bell.el.querySelector('.notification-bell-item.is-empty')),
  };
}

function archiveAllButton(bell) {
  return [...bell.el.querySelectorAll('.notification-bell-mark-all')].find(
    (btn) => btn.textContent === 'Archive all',
  );
}

test.afterEach(() => {
  document.body.innerHTML = '';
});

test('Load more walks the lens to its end and then disappears', async () => {
  const inbox = createInbox(45);
  const bell = await openBell(inbox);
  assert.equal(view(bell).titles.length, 20);
  assert.equal(view(bell).loadMore, true);

  bell.el.querySelector('.notification-bell-load-more').click();
  await settle();
  assert.equal(view(bell).titles.length, 40);
  assert.equal(view(bell).loadMore, true);

  bell.el.querySelector('.notification-bell-load-more').click();
  await settle();
  const end = view(bell);
  assert.equal(end.titles.length, 45);
  assert.equal(end.titles.at(-1), 'Notification 44');
  assert.equal(end.loadMore, false);
  assert.deepEqual(
    inbox.pageRequests.map((r) => r.cursor),
    [null, 'n19', 'n39'],
  );
  bell.detach();
});

test('a lens switch starts over without the old cursor', async () => {
  const inbox = createInbox(45);
  const bell = await openBell(inbox);
  bell.el.querySelector('.notification-bell-load-more').click();
  await settle();

  bell.el.querySelector('[data-filter="unread"]').click();
  await settle();
  assert.deepEqual(inbox.pageRequests.at(-1), {
    filter: 'unread',
    cursor: null,
  });
  // Every row is read, so the unread lens is truly empty.
  const unread = view(bell);
  assert.deepEqual(unread.titles, []);
  assert.equal(unread.empty, true);
  assert.equal(unread.loadMore, false);

  bell.el.querySelector('[data-filter="all"]').click();
  await settle();
  assert.deepEqual(inbox.pageRequests.at(-1), { filter: 'all', cursor: null });
  assert.equal(view(bell).titles.length, 20);
  assert.equal(view(bell).loadMore, true);
  bell.detach();
});

test('archiving the page shown fetches the rest; empty only once exhausted', async () => {
  const inbox = createInbox(21);
  const bell = await openBell(inbox);
  assert.equal(view(bell).titles.length, 20);
  assert.equal(view(bell).loadMore, true);

  for (let i = 0; i < 20; i++) {
    bell.el.querySelector('.notification-bell-archive-btn').click();
    await settle();
    if (i < 19) assert.equal(view(bell).empty, false);
  }
  const last = view(bell);
  assert.deepEqual(last.titles, ['Notification 20']);
  assert.equal(last.empty, false);
  assert.equal(last.loadMore, false);
  assert.deepEqual(
    inbox.pageRequests.map((r) => r.cursor),
    [null, 'n19'],
  );

  bell.el.querySelector('.notification-bell-archive-btn').click();
  await settle();
  const exhausted = view(bell);
  assert.deepEqual(exhausted.titles, []);
  assert.equal(exhausted.empty, true);
  assert.equal(exhausted.loadMore, false);
  assert.equal(inbox.remaining(), 0);
  assert.equal(inbox.pageRequests.length, 2);
  bell.detach();
});

test('a failed fetch after archiving the page keeps Load more, not the empty state', async () => {
  const inbox = createInbox(21);
  const bell = await openBell(inbox);
  const consoleError = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 20; i++) {
      if (i === 19) inbox.failNextPage();
      bell.el.querySelector('.notification-bell-archive-btn').click();
      await settle();
    }
  } finally {
    console.error = consoleError;
  }
  const stranded = view(bell);
  assert.deepEqual(stranded.titles, []);
  assert.equal(stranded.empty, false);
  assert.equal(stranded.loadMore, true);

  bell.el.querySelector('.notification-bell-load-more').click();
  await settle();
  assert.deepEqual(view(bell).titles, ['Notification 20']);
  assert.equal(view(bell).loadMore, false);
  bell.detach();
});

test('a Load more answer arriving after Archive all leaves the inbox empty', async () => {
  const inbox = createInbox(45);
  const bell = await openBell(inbox);
  const release = inbox.holdNextPage();
  bell.el.querySelector('.notification-bell-load-more').click();
  await settle();
  assert.equal(
    bell.el.querySelector('.notification-bell-load-more').disabled,
    true,
  );

  archiveAllButton(bell).click();
  await settle();
  assert.equal(view(bell).empty, true);
  assert.equal(inbox.remaining(), 0);

  release();
  await settle();
  const after = view(bell);
  assert.deepEqual(after.titles, []);
  assert.equal(after.empty, true);
  assert.equal(after.loadMore, false);

  // New reads still work: the archived lens shows the 45, from its start.
  bell.el.querySelector('[data-filter="archived"]').click();
  await settle();
  assert.deepEqual(inbox.pageRequests.at(-1), {
    filter: 'archived',
    cursor: null,
  });
  assert.equal(view(bell).titles.length, 20);
  assert.equal(view(bell).loadMore, true);
  bell.el.querySelector('.notification-bell-load-more').click();
  await settle();
  assert.equal(view(bell).titles.length, 40);

  // …and so does closing and reopening on the All lens.
  bell.el.querySelector('[data-filter="all"]').click();
  await settle();
  bell.el.querySelector('.notification-bell-btn').click();
  bell.el.querySelector('.notification-bell-btn').click();
  await settle();
  assert.equal(view(bell).empty, true);
  assert.equal(view(bell).loadMore, false);
  bell.detach();
});

test('a lens switch during Archive all reads that lens again afterwards', async () => {
  const inbox = createInbox(45);
  const bell = await openBell(inbox);
  const release = inbox.holdNextArchive();
  archiveAllButton(bell).click();
  await settle();

  // The archived lens is read before the mutation lands: still empty.
  bell.el.querySelector('[data-filter="archived"]').click();
  await settle();
  assert.equal(view(bell).empty, true);
  const reads = inbox.pageRequests.length;

  release();
  await settle();
  assert.equal(inbox.pageRequests.length, reads + 1);
  assert.deepEqual(inbox.pageRequests.at(-1), {
    filter: 'archived',
    cursor: null,
  });
  assert.equal(view(bell).titles.length, 20);
  assert.equal(view(bell).loadMore, true);
  bell.detach();
});
