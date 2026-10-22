/**
 * The list-page contract (B819, D358): `server/services/list-page.js` reads
 * `{ limit, cursor }`, refuses `offset` and anything out of bounds as a 400
 * `invalid` naming `details.field`, and round-trips the cursor against the
 * list's order and filters. The keyset half (completeness, order, stability,
 * isolation, full pages) needs real PostgreSQL row values and microseconds:
 * tests/pg/notification-list-page.pgtest.js.
 *
 * Run with: node --test tests/list-page.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIST_PAGE_DEFAULT_LIMIT,
  LIST_PAGE_MAX_LIMIT,
  encodeCursor,
  listPageResult,
  parseListPage,
} from '../server/services/list-page.js';
import { handleNotifications } from '../server/routes/api/notifications.js';
import { createMockRes } from './helpers/http-mocks.js';

const ID = '0b6f6a4e-0c5e-4f43-9d1e-2b0f3c6a7d11';
const POSITION = { value: '2026-10-22 09:20:00.123456+00', id: ID };
const NOTIFICATIONS = { sortKey: 'created_desc', filters: { filter: 'all' } };

/** Assert that a call throws the canonical 400 `invalid` for one field. */
function assertRefused(fn, field) {
  assert.throws(fn, (err) => {
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'invalid');
    assert.equal(err.details?.field, field);
    return true;
  });
}

const query = (params) => new URLSearchParams(params);

describe('parseListPage: limit', () => {
  it('defaults to the surface default, else 50', () => {
    assert.equal(parseListPage(query({}), NOTIFICATIONS).limit, 50);
    assert.equal(LIST_PAGE_DEFAULT_LIMIT, 50);
    assert.equal(
      parseListPage(query({}), { ...NOTIFICATIONS, defaultLimit: 20 }).limit,
      20,
    );
  });

  it('accepts 1..100 from a query string or a tool argument', () => {
    assert.equal(parseListPage(query({ limit: '1' }), NOTIFICATIONS).limit, 1);
    assert.equal(
      parseListPage(query({ limit: '100' }), NOTIFICATIONS).limit,
      100,
    );
    assert.equal(parseListPage({ limit: 7 }, NOTIFICATIONS).limit, 7);
    assert.equal(LIST_PAGE_MAX_LIMIT, 100);
  });

  it('refuses 0, 101, non-numeric and fractional limits instead of clamping', () => {
    for (const limit of ['0', '101', '500', 'abc', '-1', '2.5', ' 5']) {
      assertRefused(
        () => parseListPage(query({ limit }), NOTIFICATIONS),
        'limit',
      );
    }
    for (const limit of [0, 101, 2.5, true, [5]]) {
      assertRefused(() => parseListPage({ limit }, NOTIFICATIONS), 'limit');
    }
  });

  it('a surface may lower the default, never raise it', () => {
    for (const defaultLimit of [0, 51, 101, 2.5]) {
      assert.throws(() =>
        parseListPage(query({}), { ...NOTIFICATIONS, defaultLimit }),
      );
    }
  });
});

describe('parseListPage: offset', () => {
  it('refuses offset in any form, pointing at cursor', () => {
    for (const input of [
      query({ offset: '0' }),
      query({ offset: '20' }),
      query({ offset: '' }),
      { offset: 0 },
    ]) {
      assert.throws(
        () => parseListPage(input, NOTIFICATIONS),
        (err) => {
          assert.equal(err.code, 'invalid');
          assert.deepEqual(err.details, { field: 'offset', use: 'cursor' });
          return true;
        },
      );
    }
  });
});

describe('parseListPage: cursor', () => {
  it('starts at the top without one', () => {
    assert.equal(parseListPage(query({}), NOTIFICATIONS).after, null);
    assert.equal(
      parseListPage(query({ cursor: '' }), NOTIFICATIONS).after,
      null,
    );
  });

  it('round-trips a position for the same list and filters', () => {
    const page = parseListPage(query({}), NOTIFICATIONS);
    const cursor = encodeCursor(page, POSITION);
    assert.match(cursor, /^[A-Za-z0-9_-]+$/, 'opaque base64url');
    assert.deepEqual(
      parseListPage(query({ cursor }), NOTIFICATIONS).after,
      POSITION,
    );
    assert.deepEqual(parseListPage({ cursor }, NOTIFICATIONS).after, POSITION);
  });

  it('keeps microseconds: the sort value is never parsed into a Date', () => {
    const page = parseListPage(query({}), NOTIFICATIONS);
    const position = { value: '2026-10-22 09:20:00.000001+00', id: ID };
    const cursor = encodeCursor(page, position);
    assert.equal(
      parseListPage(query({ cursor }), NOTIFICATIONS).after.value,
      position.value,
    );
  });

  it('refuses a broken cursor', () => {
    const encode = (payload) =>
      Buffer.from(JSON.stringify(payload)).toString('base64url');
    const good = {
      v: 1,
      s: 'created_desc',
      f: parseListPage(query({}), NOTIFICATIONS).fingerprint,
      k: [POSITION.value, ID],
    };
    for (const cursor of [
      'not-a-cursor',
      '%%%',
      encode('just a string'),
      encode({ ...good, v: 2 }),
      encode({ ...good, k: [POSITION.value] }),
      encode({ ...good, k: ['yesterday', ID] }),
      encode({ ...good, k: [POSITION.value, 'not-a-uuid'] }),
      encode({ ...good, k: ["2026-10-22'; drop table x; --", ID] }),
    ]) {
      assertRefused(
        () => parseListPage(query({ cursor }), NOTIFICATIONS),
        'cursor',
      );
    }
    assertRefused(() => parseListPage({ cursor: 42 }, NOTIFICATIONS), 'cursor');
    // The control: the same payload, unbroken, is accepted.
    assert.deepEqual(
      parseListPage(query({ cursor: encode(good) }), NOTIFICATIONS).after,
      POSITION,
    );
  });

  it('refuses a cursor from another list', () => {
    const other = parseListPage(query({}), {
      sortKey: 'modified_desc',
      filters: { filter: 'all' },
    });
    const cursor = encodeCursor(other, POSITION);
    assertRefused(
      () => parseListPage(query({ cursor }), NOTIFICATIONS),
      'cursor',
    );
  });

  it('refuses a cursor made under other filters', () => {
    const unread = parseListPage(query({}), {
      sortKey: 'created_desc',
      filters: { filter: 'unread' },
    });
    const cursor = encodeCursor(unread, POSITION);
    assertRefused(
      () => parseListPage(query({ cursor }), NOTIFICATIONS),
      'cursor',
    );
  });

  it('the fingerprint ignores key order and absent filters', () => {
    const a = parseListPage(query({}), {
      sortKey: 'x',
      filters: { a: 1, b: 'two', c: undefined },
    });
    const b = parseListPage(query({}), {
      sortKey: 'x',
      filters: { b: 'two', a: 1, d: null },
    });
    assert.equal(a.fingerprint, b.fingerprint);
  });
});

describe('listPageResult', () => {
  it('names the collection and ends with a null cursor', () => {
    const page = parseListPage(query({}), NOTIFICATIONS);
    assert.deepEqual(
      listPageResult('notifications', { items: [], next: null }, page),
      { notifications: [], nextCursor: null },
    );
    const more = listPageResult(
      'notifications',
      { items: [{ id: ID }], next: POSITION },
      page,
    );
    assert.deepEqual(Object.keys(more), ['notifications', 'nextCursor']);
    assert.deepEqual(
      parseListPage(query({ cursor: more.nextCursor }), NOTIFICATIONS).after,
      POSITION,
    );
  });
});

describe('GET /api/notifications refuses through the error envelope', () => {
  async function get(search) {
    const res = createMockRes();
    const url = new URL(`http://x/api/notifications${search}`);
    await handleNotifications({
      repoRoot: '/tmp',
      storageScope: { organizationId: '00000000-0000-0000-0000-0000000000aa' },
      authedUser: { email: 'a@b.test' },
      req: { method: 'GET', headers: {} },
      res,
      url,
    });
    return { status: res.statusCode, body: res.json() };
  }

  for (const [search, field] of [
    ['?limit=0', 'limit'],
    ['?limit=101', 'limit'],
    ['?limit=many', 'limit'],
    ['?offset=20', 'offset'],
    ['?cursor=broken', 'cursor'],
  ]) {
    it(`${search} → 400 invalid, details.field = ${field}`, async () => {
      const { status, body } = await get(search);
      assert.equal(status, 400);
      assert.equal(body.ok, false);
      assert.equal(body.error, 'invalid');
      assert.equal(body.details.field, field);
    });
  }

  it('a cursor from the unread lens is refused on the all lens', async () => {
    const unread = parseListPage(query({}), {
      sortKey: 'created_desc',
      filters: { filter: 'unread' },
    });
    const cursor = encodeCursor(unread, POSITION);
    const { status, body } = await get(`?filter=all&cursor=${cursor}`);
    assert.equal(status, 400);
    assert.equal(body.details.field, 'cursor');
    // …and accepted on the lens it was made for.
    const ok = await get(`?filter=unread&cursor=${cursor}`);
    assert.equal(ok.status, 200);
  });

  it('answers the contract shape: no total, no offset, a nextCursor', async () => {
    const { status, body } = await get('?limit=5');
    assert.equal(status, 200);
    assert.deepEqual(body.notifications, []);
    assert.equal(body.nextCursor, null);
    for (const retired of ['total', 'hasMore', 'offset', 'pagination']) {
      assert.equal(Object.hasOwn(body, retired), false, retired);
    }
  });
});
