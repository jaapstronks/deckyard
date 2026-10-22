/**
 * The notification inbox on the list-page contract, against real PostgreSQL
 * (B819, D358).
 *
 * `tests/list-page.test.js` pins the input half (bounds, offset, cursor
 * refusals). This pins what only PostgreSQL can vouch for: the row-value
 * keyset `(created_at, id) < (:value::timestamptz, :id)` and microsecond
 * precision, through the real route. The six checks every list carries
 * (brief `db-level-pagination.md` § Checks):
 *
 *  1. completeness: every row exactly once, across ten rows with one
 *     identical timestamp and rows a microsecond apart;
 *  2. order: the pages concatenated equal `(created_at desc, id desc)`;
 *  3. stability: a row added at the top between pages does not move page 2;
 *  4. org isolation: a cursor from org A used in org B shows only B's rows;
 *  5. refusal: a cursor from another lens is refused (the rest of the
 *     refusals need no database: tests/list-page.test.js);
 *  6. full pages: every page but the last has exactly `limit` rows, also on
 *     a filtered lens.
 *
 * Plus migration 095 (NOT NULL backfill, keyset index) and an `EXPLAIN` on
 * 10 000 rows showing the query walks that index without a sort.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { CompiledQuery, sql } from 'kysely';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { createMockRes } from '../helpers/http-mocks.js';
import { handleNotifications } from '../../server/routes/api/notifications.js';
import {
  encodeCursor,
  parseListPage,
} from '../../server/services/list-page.js';
import { keysetPage } from '../../server/storage/keyset.js';
import {
  down as migrate095Down,
  up as migrate095Up,
} from '../../server/db/migrations/095_notification_keyset.js';

const USER = 'reader@example.com';
const SAME_MOMENT = '2026-10-01 12:00:00.123456+00';

pgDescribe('notification list page (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let orgA;
  let orgB;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations', 'user_notifications');
    orgA = await seedDefaultOrganization(db);
    orgB = crypto.randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: orgB, name: 'Other Org', slug: 'other-org' })
      .execute();
  });

  /** Insert one notification row and return its id. */
  async function insert({
    organizationId = orgA,
    createdAt,
    isRead = false,
    archived = false,
  }) {
    const id = crypto.randomUUID();
    await db
      .insertInto('user_notifications')
      .values({
        id,
        organization_id: organizationId,
        user_email: USER,
        notification_type: 'general',
        title: `n ${createdAt}`,
        is_read: isRead,
        created_at: createdAt,
        archived_at: archived ? createdAt : null,
      })
      .execute();
    return id;
  }

  /**
   * The 23-row inbox of org A: ten rows at one identical microsecond, five
   * rows one microsecond apart inside one millisecond, eight spread out.
   * @returns {Promise<string[]>} The ids.
   */
  async function seedInbox({ readEvery = 0 } = {}) {
    const stamps = [
      ...Array.from({ length: 10 }, () => SAME_MOMENT),
      ...Array.from(
        { length: 5 },
        (_, i) => `2026-10-01 12:00:01.00000${i + 1}+00`,
      ),
      ...Array.from(
        { length: 8 },
        (_, i) => `2026-09-${String(10 + i).padStart(2, '0')} 08:00:00+00`,
      ),
    ];
    const ids = [];
    for (const [i, createdAt] of stamps.entries()) {
      const isRead = readEvery > 0 && i % readEvery === 0;
      ids.push(await insert({ createdAt, isRead }));
    }
    return ids;
  }

  /** The inbox in the contract's order, straight from SQL. */
  async function expectedOrder(organizationId, where = sql`true`) {
    const rows = await sql`
      SELECT id FROM user_notifications
      WHERE organization_id = ${organizationId} AND user_email = ${USER}
        AND archived_at IS NULL AND ${where}
      ORDER BY created_at DESC, id DESC
    `.execute(db);
    return rows.rows.map((row) => row.id);
  }

  /** GET /api/notifications through the real route. */
  async function get(params, organizationId = orgA) {
    const res = createMockRes();
    const search = new URLSearchParams(params).toString();
    await handleNotifications({
      repoRoot: null,
      storageScope:
        organizationId === orgA
          ? testScope()
          : { repoRoot: null, organizationId },
      authedUser: { email: USER },
      req: { method: 'GET', headers: {} },
      res,
      url: new URL(`http://x/api/notifications?${search}`),
    });
    return { status: res.statusCode, body: res.json() };
  }

  /** Walk every page of one lens; returns the pages as id lists. */
  async function walk(params, organizationId = orgA) {
    const pages = [];
    let cursor = null;
    for (let guard = 0; guard < 50; guard++) {
      const { status, body } = await get(
        cursor ? { ...params, cursor } : params,
        organizationId,
      );
      assert.equal(status, 200, JSON.stringify(body));
      pages.push(body.notifications.map((n) => n.id));
      cursor = body.nextCursor;
      if (cursor === null) return pages;
    }
    throw new Error('the list never ended');
  }

  it('1+2+6: every row once, in (created_at desc, id desc), full pages until the end', async () => {
    const ids = await seedInbox();
    const pages = await walk({ limit: '5' });

    assert.deepEqual(
      pages.map((page) => page.length),
      [5, 5, 5, 5, 3],
      'full pages until the last one',
    );
    const seen = pages.flat();
    assert.equal(new Set(seen).size, seen.length, 'no row twice');
    assert.deepEqual([...seen].sort(), [...ids].sort(), 'no row skipped');
    assert.deepEqual(seen, await expectedOrder(orgA), 'the contract order');
  });

  it('1: ten rows at the same microsecond split across pages without loss', async () => {
    const ids = [];
    for (let i = 0; i < 10; i++)
      ids.push(await insert({ createdAt: SAME_MOMENT }));
    const pages = await walk({ limit: '3' });
    assert.deepEqual(
      pages.map((page) => page.length),
      [3, 3, 3, 1],
    );
    assert.deepEqual(
      pages.flat(),
      [...ids].sort().reverse(),
      'id desc as tiebreaker',
    );
  });

  it('2: the cursor keeps microseconds (rows inside one millisecond)', async () => {
    const ids = [];
    for (let i = 1; i <= 6; i++) {
      ids.push(await insert({ createdAt: `2026-10-01 12:00:01.00000${i}+00` }));
    }
    const pages = await walk({ limit: '1' });
    assert.deepEqual(pages.flat(), [...ids].reverse());
  });

  it('3: a row added at the top between pages does not move page 2', async () => {
    await seedInbox();
    const first = await get({ limit: '5' });
    const cursor = first.body.nextCursor;
    const before = await get({ limit: '5', cursor });

    await insert({ createdAt: '2026-10-22 09:00:00.000001+00' });
    const afterInsert = await get({ limit: '5', cursor });

    assert.deepEqual(
      afterInsert.body.notifications.map((n) => n.id),
      before.body.notifications.map((n) => n.id),
    );
    assert.equal(afterInsert.body.nextCursor, before.body.nextCursor);
  });

  it('4: a cursor from org A used in org B only shows B rows', async () => {
    const idsA = await seedInbox();
    const idsB = [];
    for (const createdAt of [
      '2026-10-05 00:00:00+00',
      SAME_MOMENT,
      '2026-09-15 00:00:00+00',
      '2026-08-01 00:00:00+00',
    ]) {
      idsB.push(await insert({ organizationId: orgB, createdAt }));
    }

    const first = await get({ limit: '5' });
    const cursorFromA = first.body.nextCursor;
    assert.ok(cursorFromA);

    const { status, body } = await get(
      { limit: '100', cursor: cursorFromA },
      orgB,
    );
    assert.equal(status, 200);
    const shown = body.notifications.map((n) => n.id);
    assert.ok(shown.length > 0, 'the position still applies in B');
    for (const id of shown) {
      assert.ok(idsB.includes(id), 'only B rows');
      assert.ok(!idsA.includes(id), 'never an A row');
    }

    const allB = (await walk({ limit: '2' }, orgB)).flat();
    assert.deepEqual(allB, await expectedOrder(orgB));
  });

  it('5+6: a filtered lens pages full and refuses a cursor from another lens', async () => {
    await seedInbox({ readEvery: 3 });
    const pages = await walk({ limit: '4', filter: 'unread' });
    for (const page of pages.slice(0, -1)) {
      assert.equal(page.length, 4, 'nothing is removed after the LIMIT');
    }
    assert.deepEqual(
      pages.flat(),
      await expectedOrder(orgA, sql`is_read = false`),
    );

    const unreadFirst = await get({ limit: '4', filter: 'unread' });
    const refused = await get({
      limit: '4',
      filter: 'all',
      cursor: unreadFirst.body.nextCursor,
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'invalid');
    assert.equal(refused.body.details.field, 'cursor');
  });

  it('5: invalid calendar, time and offset cursors return 400 through the PostgreSQL route', async () => {
    await seedInbox();
    const page = parseListPage(
      {},
      { sortKey: 'created_desc', filters: { filter: 'all' } },
    );
    for (const value of [
      '2026-02-30 12:00:00+00',
      '2026-13-01 12:00:00+00',
      '1900-02-29 12:00:00+00',
      '2026-01-01 25:00:00+00',
      '2026-01-01 12:60:00+00',
      '2026-01-01 12:00:61+00',
      '2026-01-01 12:00:00+16:00',
      '2026-01-01 12:00:00+00:60',
    ]) {
      const cursor = encodeCursor(page, { value, id: crypto.randomUUID() });
      const { status, body } = await get({ cursor });
      assert.equal(status, 400, value);
      assert.equal(body.error, 'invalid', value);
      assert.equal(body.details.field, 'cursor', value);
    }
    // Accepted boundaries must also survive the actual timestamptz cast.
    for (const value of [
      '2000-02-29 23:59:59.999999+15:59',
      '2024-02-29T00:00:00.000001Z',
    ]) {
      const cursor = encodeCursor(page, { value, id: crypto.randomUUID() });
      assert.equal((await get({ cursor })).status, 200, value);
    }
  });

  it('5: refuses unknown/empty filters and the retired unread parameter through the route', async () => {
    for (const params of [
      { filter: 'unknown' },
      { filter: '' },
      { unread: 'true' },
      { filter: 'all', unread: '' },
    ]) {
      const { status, body } = await get(params);
      assert.equal(status, 400);
      assert.equal(body.error, 'invalid');
      assert.equal(
        body.details.field,
        'unread' in params ? 'unread' : 'filter',
      );
      if ('unread' in params) assert.equal(body.details.use, 'filter=unread');
    }
  });

  it('migration 095 backfills a NULL created_at and makes the column NOT NULL', async () => {
    const runInTx = (fn) => db.transaction().execute((trx) => fn(trx));
    await runInTx(migrate095Down);
    try {
      const readAt = '2026-09-01 10:00:00.5+00';
      const id = crypto.randomUUID();
      await sql`
        INSERT INTO user_notifications
          (id, organization_id, user_email, notification_type, title, is_read, read_at, created_at)
        VALUES (${id}, ${orgA}, ${USER}, 'general', 'old', true, ${readAt}::timestamptz, NULL)
      `.execute(db);

      await runInTx(migrate095Up);

      const row = await sql`
        SELECT created_at = ${readAt}::timestamptz AS backfilled
        FROM user_notifications WHERE id = ${id}
      `.execute(db);
      assert.equal(row.rows[0].backfilled, true, 'read_at is the backfill');
      await assert.rejects(
        insert({ createdAt: null }),
        /null value|not-null/i,
        'NOT NULL holds',
      );
      // Idempotent: a second run finds nothing to do.
      await runInTx(migrate095Up);
    } finally {
      // Leave the schema migrated whatever happened above.
      await runInTx(migrate095Up);
    }
  });

  it('the page query walks idx_user_notifications_keyset without a sort (10 000 rows)', async () => {
    await sql`
      INSERT INTO user_notifications
        (organization_id, user_email, notification_type, title, created_at)
      SELECT ${orgA}, ${USER}, 'general', 'bulk',
        timestamptz '2026-01-01' + (g * interval '1 minute')
      FROM generate_series(1, 10000) AS g
    `.execute(db);
    await sql`ANALYZE user_notifications`.execute(db);

    const page = keysetPage(
      db
        .selectFrom('user_notifications')
        .selectAll()
        .where('user_email', '=', USER)
        .where('organization_id', '=', orgA)
        .where('archived_at', 'is', null),
      {
        column: 'created_at',
        after: { value: '2026-01-04 00:00:00+00', id: crypto.randomUUID() },
        limit: 20,
      },
    ).compile();
    const plan = await db.executeQuery(
      CompiledQuery.raw(`EXPLAIN ${page.sql}`, [...page.parameters]),
    );
    const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    assert.match(text, /idx_user_notifications_keyset/, text);
    assert.doesNotMatch(text, /\bSort\b/, text);
  });
});
