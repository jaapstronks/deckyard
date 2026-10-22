/**
 * The last lists on the list-page contract, against real PostgreSQL (B825,
 * D358).
 *
 * Four lists, one contract (`{ limit, cursor }` in, `{ <collection>,
 * nextCursor }` out, order `(<time> desc, id desc)`):
 *
 *  - a deck's viewer sessions (`/api/presentations/:id/analytics/sessions`,
 *    `started_at`, the date window as the cursor's fingerprint);
 *  - a deck's analytics reports (`…/analytics/reports`, `created_at`);
 *  - an organization's members (`/api/organizations/:id/members`, the
 *    membership's `created_at`), with the count on its own path;
 *  - the admin user list (`/api/admin/users`, `created_at`).
 *
 * Each carries the six checks (brief `db-level-pagination.md` § Checks):
 * completeness, order, stability, org isolation, refusal and full pages,
 * through the route. Plus migration 101 (NOT NULL backfill) and an `EXPLAIN`
 * on 10 000 rows showing each list walks its keyset index without a sort.
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
import { createMockRes } from '../helpers/http-mocks.js';
import { handleAnalytics } from '../../server/routes/api/analytics/index.js';
import { handleOrganizationMembers } from '../../server/routes/api/organization-members.js';
import { handleAdminUsers } from '../../server/routes/api/admin-users.js';
import { keysetPage } from '../../server/storage/keyset.js';
import {
  down as migrate101Down,
  up as migrate101Up,
} from '../../server/db/migrations/101_remaining_list_keyset.js';

const SAME_MOMENT = '2026-10-01 12:00:00.123456+00';

/** The n-th of 23 timestamps: the first twelve identical to the microsecond. */
const stamp = (n) =>
  n < 12
    ? SAME_MOMENT
    : `2026-10-01 12:00:00.1234${String(n).padStart(2, '0')}+00`;

pgDescribe(
  'remaining lists on the list-page contract (real PostgreSQL)',
  () => {
    /** @type {import('kysely').Kysely<any>} */
    let db;
    const orgs = {};
    const owners = {};
    const decks = {};
    const multiOrgBefore = process.env.MULTI_ORG_ENABLED;

    before(async () => {
      process.env.MULTI_ORG_ENABLED = 'true';
      db = await openTestDb();
      await installFacadeStorage();
    });

    after(async () => {
      if (multiOrgBefore === undefined) delete process.env.MULTI_ORG_ENABLED;
      else process.env.MULTI_ORG_ENABLED = multiOrgBefore;
      await closeTestDb(db);
    });

    beforeEach(async () => {
      await truncate(db, 'organizations', 'users', 'presentations');
      orgs.A = await seedDefaultOrganization(db);
      orgs.B = crypto.randomUUID();
      await db
        .insertInto('organizations')
        .values({ id: orgs.B, name: 'Other Org', slug: 'other-org' })
        .execute();
      for (const key of ['A', 'B']) {
        owners[key] = {
          id: crypto.randomUUID(),
          email: `owner-${key.toLowerCase()}@example.com`,
        };
        await insertUser(orgs[key], owners[key], '2026-01-01 00:00:00+00');
        await insertMembership(orgs[key], owners[key].id, {
          role: 'owner',
          createdAt: '2026-01-01 00:00:00+00',
        });
        decks[key] = crypto.randomUUID();
        await db
          .insertInto('presentations')
          .values({
            id: decks[key],
            organization_id: orgs[key],
            title: `Deck ${key}`,
            owner_user_id: owners[key].id,
            owner_email: owners[key].email,
            created_by_user_id: owners[key].id,
            created_by: owners[key].email,
          })
          .execute();
      }
    });

    async function insertUser(organizationId, person, createdAt) {
      await db
        .insertInto('users')
        .values({
          id: person.id,
          organization_id: organizationId,
          email: person.email,
          name: person.email.split('@')[0],
          role: 'user',
          created_at: createdAt,
        })
        .execute();
    }

    async function insertMembership(organizationId, userId, opts = {}) {
      const id = crypto.randomUUID();
      await db
        .insertInto('user_organizations')
        .values({
          id,
          user_id: userId,
          organization_id: organizationId,
          role: opts.role ?? 'member',
          created_at: opts.createdAt,
          joined_at: opts.createdAt,
        })
        .execute();
      return id;
    }

    /**
     * Per list: how to add one row at a moment, the expected order in SQL, the
     * route path, and the collection name.
     */
    const LISTS = {
      sessions: {
        collection: 'sessions',
        path: (key) => `/api/presentations/${decks[key]}/analytics/sessions`,
        route: handleAnalytics,
        add: async (key, at) => {
          const row = await db
            .insertInto('view_sessions')
            .values({
              presentation_id: decks[key],
              session_token: crypto.randomBytes(32).toString('hex'),
              source_type: 'share_link',
              viewer_type: 'anonymous',
              started_at: at,
              last_activity_at: at,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          return row.id;
        },
        ordered: async (key) =>
          (
            await sql`SELECT id FROM view_sessions WHERE presentation_id = ${decks[key]}
            ORDER BY started_at DESC, id DESC`.execute(db)
          ).rows.map((r) => r.id),
        idOf: (row) => row.id,
      },
      reports: {
        collection: 'reports',
        path: (key) => `/api/presentations/${decks[key]}/analytics/reports`,
        route: handleAnalytics,
        add: async (key, at) => {
          const row = await db
            .insertInto('analytics_reports')
            .values({
              organization_id: orgs[key],
              presentation_id: decks[key],
              title: 'Report',
              report_type: 'summary',
              start_date: '2026-09-01 00:00:00+00',
              end_date: '2026-09-30 00:00:00+00',
              created_by: owners[key].email,
              created_at: at,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          return row.id;
        },
        ordered: async (key) =>
          (
            await sql`SELECT id FROM analytics_reports WHERE presentation_id = ${decks[key]}
            ORDER BY created_at DESC, id DESC`.execute(db)
          ).rows.map((r) => r.id),
        idOf: (row) => row.id,
      },
      members: {
        collection: 'members',
        path: (key) => `/api/organizations/${orgs[key]}/members`,
        route: handleOrganizationMembers,
        add: async (key, at) => {
          const person = {
            id: crypto.randomUUID(),
            email: `m-${crypto.randomUUID()}@example.com`,
          };
          await insertUser(orgs[key], person, at);
          return insertMembership(orgs[key], person.id, { createdAt: at });
        },
        ordered: async (key) =>
          (
            await sql`SELECT id FROM user_organizations WHERE organization_id = ${orgs[key]}
            ORDER BY created_at DESC, id DESC`.execute(db)
          ).rows.map((r) => r.id),
        idOf: (row) => row.membershipId,
      },
      users: {
        collection: 'users',
        path: () => '/api/admin/users',
        route: handleAdminUsers,
        admin: true,
        add: async (key, at) => {
          const person = {
            id: crypto.randomUUID(),
            email: `u-${crypto.randomUUID()}@example.com`,
          };
          await insertUser(orgs[key], person, at);
          return person.id;
        },
        ordered: async (key) =>
          (
            await sql`SELECT id FROM users WHERE organization_id = ${orgs[key]}
            ORDER BY created_at DESC, id DESC`.execute(db)
          ).rows.map((r) => r.id),
        idOf: (row) => row.id,
      },
    };

    /** GET one page of `list` in organization `key` as that org's owner. */
    async function get(list, key, params = {}, pathKey = key) {
      const spec = LISTS[list];
      const res = createMockRes();
      const search = new URLSearchParams(params).toString();
      const owner = owners[key];
      await spec.route({
        repoRoot: process.cwd(),
        storageScope: {
          repoRoot: process.cwd(),
          organizationId: orgs[key],
          actorUserId: owner.id,
          actorEmail: owner.email,
        },
        authedUser: {
          id: owner.id,
          email: owner.email,
          organizationId: orgs[key],
          organizationRole: 'owner',
          isAdmin: Boolean(spec.admin),
        },
        req: { method: 'GET', headers: {} },
        res,
        url: new URL(`http://x${spec.path(pathKey)}?${search}`),
      });
      return { status: res.statusCode, body: res.json() };
    }

    /** Walk `list` to its end, five rows a page. */
    async function walk(list, key, params = {}) {
      const pages = [];
      let cursor = null;
      for (let guard = 0; guard < 200; guard++) {
        const { status, body } = await get(list, key, {
          limit: '5',
          ...params,
          ...(cursor ? { cursor } : {}),
        });
        assert.equal(status, 200, `${list}: ${JSON.stringify(body)}`);
        assert.equal(body.total, undefined, `${list}: no total`);
        pages.push(body[LISTS[list].collection].map(LISTS[list].idOf));
        cursor = body.nextCursor;
        if (cursor === null) return pages;
      }
      throw new Error(`${list}: the list never ended`);
    }

    async function seed(list, key = 'A') {
      for (let n = 0; n < 23; n++) await LISTS[list].add(key, stamp(n));
    }

    for (const list of Object.keys(LISTS)) {
      it(`${list} 1+2+6: every row once, in (time desc, id desc), full pages, microseconds kept`, async () => {
        await seed(list);
        const pages = await walk(list, 'A');
        const expected = await LISTS[list].ordered('A');
        assert.ok(expected.length >= 23);
        assert.deepEqual(pages.flat(), expected);
        for (const page of pages.slice(0, -1)) assert.equal(page.length, 5);
        assert.ok(pages.at(-1).length > 0 && pages.at(-1).length <= 5);
      });

      it(`${list} 3: a row added at the top between pages does not move page 2`, async () => {
        await seed(list);
        const first = await get(list, 'A', { limit: '5' });
        const params = { limit: '5', cursor: first.body.nextCursor };
        const second = await get(list, 'A', params);
        await LISTS[list].add('A', '2026-10-05 00:00:00+00');
        const again = await get(list, 'A', params);
        assert.deepEqual(
          again.body[LISTS[list].collection].map(LISTS[list].idOf),
          second.body[LISTS[list].collection].map(LISTS[list].idOf),
        );
      });

      it(`${list} 4: a cursor from org A used in org B only shows B rows`, async () => {
        await seed(list, 'A');
        await seed(list, 'B');
        const fromA = await get(list, 'A', { limit: '5' });
        const ofB = new Set(await LISTS[list].ordered('B'));
        let cursor = fromA.body.nextCursor;
        let seen = 0;
        while (cursor) {
          const { status, body } = await get(list, 'B', { limit: '5', cursor });
          assert.equal(status, 200, JSON.stringify(body));
          for (const row of body[LISTS[list].collection]) {
            assert.equal(ofB.has(LISTS[list].idOf(row)), true);
            seen++;
          }
          cursor = body.nextCursor;
        }
        assert.ok(seen > 0, 'org B answered rows of its own');
      });

      it(`${list} 5: limit, offset and foreign cursors are refused`, async () => {
        await seed(list);
        const foreign = Buffer.from(
          JSON.stringify({
            v: 1,
            s: 'trashed_desc',
            f: 'x',
            k: ['2026-10-01 12:00:00+00', crypto.randomUUID()],
          }),
        ).toString('base64url');
        for (const [params, field] of [
          [{ limit: '0' }, 'limit'],
          [{ limit: '101' }, 'limit'],
          [{ limit: 'abc' }, 'limit'],
          [{ offset: '5' }, 'offset'],
          [{ cursor: 'not-a-cursor' }, 'cursor'],
          [{ cursor: foreign }, 'cursor'],
        ]) {
          const { status, body } = await get(list, 'A', params);
          assert.equal(status, 400, `${list} ${JSON.stringify(params)}`);
          assert.equal(body.error, 'invalid');
          assert.equal(body.details.field, field, JSON.stringify(params));
        }
      });
    }

    it('sessions: the date window is the fingerprint, so a cursor under another window is refused', async () => {
      await seed('sessions');
      const first = await get('sessions', 'A', { limit: '5' });
      const { status, body } = await get('sessions', 'A', {
        limit: '5',
        since: '2026-09-01',
        cursor: first.body.nextCursor,
      });
      assert.equal(status, 400);
      assert.equal(body.details.field, 'cursor');
    });

    it('members: the count is its own path and counts the organization', async () => {
      await seed('members');
      const res = createMockRes();
      await handleOrganizationMembers({
        repoRoot: process.cwd(),
        authedUser: { email: owners.A.email, organizationId: orgs.A },
        req: { method: 'GET', headers: {} },
        res,
        url: new URL(`http://x/api/organizations/${orgs.A}/members/count`),
      });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { count: 24 });
    });

    it('migration 101 backfills a NULL created_at and makes the columns NOT NULL', async () => {
      const runInTx = (fn) => db.transaction().execute((trx) => fn(trx));
      await runInTx(migrate101Down);
      try {
        const person = {
          id: crypto.randomUUID(),
          email: 'null-stamp@example.com',
        };
        await insertUser(orgs.A, person, null);
        const membership = await insertMembership(orgs.A, person.id, {
          createdAt: null,
        });
        await sql`UPDATE user_organizations SET joined_at = ${SAME_MOMENT} WHERE id = ${membership}`.execute(
          db,
        );
        const report = await LISTS.reports.add('A', null);
        await runInTx(migrate101Up);
        const stamped = await sql`
        SELECT
          (SELECT created_at IS NOT NULL FROM users WHERE id = ${person.id}) AS u,
          (SELECT created_at = ${SAME_MOMENT}::timestamptz FROM user_organizations WHERE id = ${membership}) AS m,
          (SELECT created_at IS NOT NULL FROM analytics_reports WHERE id = ${report}) AS r
      `.execute(db);
        assert.deepEqual(stamped.rows[0], { u: true, m: true, r: true });
        await assert.rejects(
          LISTS.reports.add('A', null),
          /null value|not-null/i,
          'NOT NULL holds',
        );
        await runInTx(migrate101Up);
      } finally {
        await runInTx(migrate101Up);
      }
    });

    it('each list walks its keyset index without a sort (10 000 rows)', async () => {
      await sql`
      INSERT INTO view_sessions
        (presentation_id, session_token, source_type, viewer_type, started_at, last_activity_at)
      SELECT ${decks.A}, md5(g::text), 'share_link', 'anonymous',
        timestamptz '2026-01-01' + g * interval '1 minute',
        timestamptz '2026-01-01' + g * interval '1 minute'
      FROM generate_series(1, 10000) AS g
    `.execute(db);
      await sql`
      INSERT INTO analytics_reports
        (organization_id, presentation_id, title, report_type, start_date, end_date, created_by, created_at)
      SELECT ${orgs.A}, ${decks.A}, 'r', 'summary', now(), now(), 'x@example.com',
        timestamptz '2026-01-01' + g * interval '1 minute'
      FROM generate_series(1, 10000) AS g
    `.execute(db);
      await sql`
      INSERT INTO users (organization_id, email, role, created_at)
      SELECT ${orgs.A}, 'bulk' || g || '@example.com', 'user',
        timestamptz '2026-01-01' + g * interval '1 minute'
      FROM generate_series(1, 10000) AS g
    `.execute(db);
      await sql`
      INSERT INTO user_organizations (user_id, organization_id, role, created_at)
      SELECT id, ${orgs.A}, 'member', created_at FROM users
      WHERE email LIKE 'bulk%'
    `.execute(db);
      for (const table of [
        'view_sessions',
        'analytics_reports',
        'users',
        'user_organizations',
      ]) {
        await sql`ANALYZE ${sql.table(table)}`.execute(db);
      }

      const after = {
        value: '2026-01-04 00:00:00+00',
        id: crypto.randomUUID(),
      };
      const explain = async (query) => {
        const compiled = query.compile();
        const plan = await db.executeQuery(
          CompiledQuery.raw(`EXPLAIN ${compiled.sql}`, [
            ...compiled.parameters,
          ]),
        );
        return plan.rows.map((row) => row['QUERY PLAN']).join('\n');
      };

      for (const [index, query] of [
        [
          'idx_view_sessions_list_keyset',
          keysetPage(
            db
              .selectFrom('view_sessions')
              .selectAll()
              .where('presentation_id', '=', decks.A),
            { column: 'started_at', after, limit: 20 },
          ),
        ],
        [
          'idx_analytics_reports_list_keyset',
          keysetPage(
            db
              .selectFrom('analytics_reports')
              .selectAll()
              .where('presentation_id', '=', decks.A)
              .where('organization_id', '=', orgs.A),
            { column: 'created_at', after, limit: 20 },
          ),
        ],
        [
          'idx_users_list_keyset',
          keysetPage(
            db
              .selectFrom('users')
              .selectAll()
              .where('organization_id', '=', orgs.A),
            { column: 'created_at', after, limit: 20 },
          ),
        ],
        [
          'idx_user_organizations_list_keyset',
          keysetPage(
            db
              .selectFrom('user_organizations')
              .innerJoin('users', 'users.id', 'user_organizations.user_id')
              .select(['user_organizations.id', 'users.email'])
              .where('user_organizations.organization_id', '=', orgs.A),
            {
              column: 'user_organizations.created_at',
              idColumn: 'user_organizations.id',
              after,
              limit: 20,
            },
          ),
        ],
      ]) {
        const plan = await explain(query);
        assert.match(plan, new RegExp(index), plan);
        assert.doesNotMatch(plan, /\bSort\b/, plan);
      }
    });
  },
);
