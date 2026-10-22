/**
 * The trash list in SQL, on the list-page contract, against real PostgreSQL
 * (B821, D358).
 *
 * The trash route used to read the organization's whole trash and keep the
 * rows `canRestorePresentation` allowed, after the read; now the predicate is
 * one query (`listTrashedDecks`, server/storage/presentations/trash-list.js)
 * with a keyset page `(trashed_at desc, id desc)`. This file is its gate:
 *
 *  - **parity**: over a fixture of every combination of owner, maker and
 *    trasher (a known user, someone else, nobody), plus live decks and a
 *    trashed deck in another organization, the SQL list equals
 *    `rows.filter(canRestorePresentation)` for the owner, the maker, a
 *    trasher, someone with no stamp, an admin, the auth-off operator, an address-only
 *    actor and actors without an identity, page by page;
 *
 * and the six checks every list carries (brief `db-level-pagination.md`
 * § Checks), through the real `GET /api/presentations/trash` route:
 *
 *  1. completeness and 2. order: every deck exactly once, in
 *     `(trashed_at desc, id desc)`, across decks trashed in one identical
 *     microsecond;
 *  3. stability: a deck trashed between pages does not move page 2;
 *  4. org isolation: a cursor from org A used in org B shows only B decks;
 *  5. refusal: `offset`, `limit` 0, 101 and not a number, a broken cursor
 *     and a cursor of another list;
 *  6. full pages: every page but the last has exactly `limit` decks, also
 *     under the narrowest predicate.
 *
 * Plus migration 097 and an `EXPLAIN` on 10 000 trashed decks showing the
 * page walks `idx_presentations_trash_keyset` without a sort.
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
import { listTrashedDecks } from '../../server/storage/presentations/index.js';
import { __trashList } from '../../server/storage/presentations/trash-list.js';
import { keysetPage } from '../../server/storage/keyset.js';
import { handlePresentations } from '../../server/routes/api/presentations/index.js';
import { canRestorePresentation } from '../../server/utils/presentation-authz/presentations.js';
import {
  down as migrate097Down,
  up as migrate097Up,
} from '../../server/db/migrations/097_trash_list_keyset.js';

const SAME_MOMENT = '2026-10-01 12:00:00.123456+00';

const person = (name, extra = {}) => ({
  id: crypto.randomUUID(),
  email: `${name}@example.com`,
  name,
  isAdmin: false,
  ...extra,
});
const OWNER = person('owner');
const MAKER = person('maker');
const TRASHER = person('trasher');
const OUTSIDER = person('outsider');
const STRANGER = person('stranger');
const ADMIN = person('admin', { isAdmin: true });

pgDescribe(
  'trash list in SQL on the list-page contract (real PostgreSQL)',
  () => {
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
      await truncate(db, 'organizations', 'users', 'presentations');
      orgA = await seedDefaultOrganization(db);
      orgB = crypto.randomUUID();
      await db
        .insertInto('organizations')
        .values({ id: orgB, name: 'Other Org', slug: 'other-org' })
        .execute();
      await db
        .insertInto('users')
        .values(
          [OWNER, MAKER, TRASHER, OUTSIDER, STRANGER, ADMIN].map((p) => ({
            id: p.id,
            organization_id: orgA,
            email: p.email,
            name: p.name,
            role: p.isAdmin ? 'admin' : 'user',
          })),
        )
        .execute();
    });

    const scopeOf = (organizationId, actor = {}) => ({
      repoRoot: process.cwd(),
      organizationId,
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
    });

    /** Insert one deck row (trashed unless `trashedAt` is null). */
    async function insertDeck({
      organizationId = orgA,
      owner = null,
      maker = owner,
      trasher = owner,
      trasherEmail = trasher?.email ?? 'external@example.net',
      trashedAt = SAME_MOMENT,
    } = {}) {
      const id = crypto.randomUUID();
      await db
        .insertInto('presentations')
        .values({
          id,
          organization_id: organizationId,
          title: 'Deck',
          visibility: 'private',
          owner_user_id: owner?.id ?? null,
          owner_email: owner?.email ?? null,
          created_by_user_id: maker?.id ?? null,
          created_by: maker?.email ?? null,
          modified_at: '2026-09-01 00:00:00+00',
          trashed_at: trashedAt,
          trashed_by: trashedAt ? trasherEmail : null,
          trashed_by_user_id: trashedAt ? (trasher?.id ?? null) : null,
        })
        .execute();
      return id;
    }

    /**
     * 3 owners × 3 makers × 3 trashers = 27 trashed decks in org A, a third
     * of them in one microsecond, the rest a microsecond apart; plus two live
     * decks of the owner and a trashed deck of the owner in org B.
     */
    async function seedMatrix() {
      const people = [OWNER, OUTSIDER, null];
      let n = 0;
      for (const owner of people) {
        for (const maker of [owner, MAKER, null]) {
          for (const trasher of [owner, TRASHER, null]) {
            await insertDeck({
              owner,
              maker,
              trasher,
              trashedAt:
                n % 3 === 0
                  ? SAME_MOMENT
                  : `2026-10-01 12:00:00.1234${String(60 + n).padStart(2, '0')}+00`,
            });
            n++;
          }
        }
      }
      await insertDeck({ owner: OWNER, trashedAt: null });
      await insertDeck({ owner: OWNER, trashedAt: null });
      await insertDeck({ organizationId: orgB, owner: OWNER });
    }

    /** Trashed decks of an org in the contract's order, straight from SQL. */
    async function contractOrder(organizationId) {
      const rows = await sql`
      SELECT id FROM presentations
      WHERE organization_id = ${organizationId} AND trashed_at IS NOT NULL
      ORDER BY trashed_at DESC, id DESC
    `.execute(db);
      return rows.rows.map((row) => row.id);
    }

    /** The JavaScript reference: every trashed row through the per-deck rule. */
    async function referenceList(actor) {
      const { items } = await listTrashedDecks(scopeOf(orgA, ADMIN), {
        reader: { isAdmin: true },
      });
      const allowed = new Set(
        items
          .filter((pres) => canRestorePresentation({ user: actor, pres }))
          .map((pres) => pres.id),
      );
      return (await contractOrder(orgA)).filter((id) => allowed.has(id));
    }

    /** GET /api/presentations/trash through the real route. */
    async function trashRoute(query, actor, organizationId = orgA) {
      const res = createMockRes();
      await handlePresentations({
        req: {
          method: 'GET',
          headers: { host: 'deck.example' },
          socket: { remoteAddress: '203.0.113.9' },
        },
        res,
        url: new URL(`http://deck.example/api/presentations/trash${query}`),
        repoRoot: process.cwd(),
        storageScope: scopeOf(organizationId, actor),
        authedUser: actor,
      });
      return { status: res.statusCode, body: res.json() };
    }

    /** Walk the route to the end; returns the pages as id lists. */
    async function walk(actor, limit, organizationId = orgA) {
      const pages = [];
      let cursor = null;
      for (let guard = 0; guard < 100; guard++) {
        const query = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const { status, body } = await trashRoute(query, actor, organizationId);
        assert.equal(status, 200, JSON.stringify(body));
        pages.push(body.presentations.map((p) => p.id));
        cursor = body.nextCursor;
        if (cursor === null) return pages;
      }
      throw new Error('the list never ended');
    }

    const ACTORS = [
      ['owner', OWNER],
      ['maker', MAKER],
      ['trasher', TRASHER],
      ['another owner', OUTSIDER],
      ['stranger', STRANGER],
      ['admin', ADMIN],
      ['auth-off operator', { email: null, unrestricted: true }],
      // An address alone matches no stamp: restoring keys on the id (D22).
      ['owner (address only)', { email: OWNER.email }],
      ['no identity', {}],
      ['no actor', undefined],
    ];

    it('parity: the SQL trash equals rows.filter(canRestorePresentation) for every actor, page by page', async () => {
      await seedMatrix();
      const sizes = {};
      for (const [label, actor] of ACTORS) {
        const expected = await referenceList(actor);
        const pages = await walk(actor, 4);
        for (const page of pages.slice(0, -1)) {
          assert.equal(page.length, 4, `${label}: a full page`);
        }
        assert.deepEqual(pages.flat(), expected, label);
        const { items } = await listTrashedDecks(scopeOf(orgA, actor), {
          reader: { userId: actor?.id ?? null, ...actor },
        });
        assert.deepEqual(
          items.map((p) => p.id),
          expected,
          `${label}: unpaged`,
        );
        sizes[label] = expected.length;
      }
      // The fixture is not trivially empty or full for anyone it should not be.
      assert.equal(sizes.admin, 27);
      assert.equal(sizes['auth-off operator'], 27);
      // Each person is the owner, the maker or the trasher of 9 decks of the
      // matrix; the owner's maker and trasher stamps only repeat the owner.
      assert.equal(sizes.owner, 9);
      assert.equal(sizes.maker, 9);
      assert.equal(sizes.trasher, 9);
      assert.equal(sizes['another owner'], 9);
      assert.equal(sizes.stranger, 0);
      assert.equal(sizes['owner (address only)'], 0);
      assert.equal(sizes['no identity'], 0);
      assert.equal(sizes['no actor'], 0);
    });

    it('1+2+6: every deck once, in (trashed_at desc, id desc), full pages until the end', async () => {
      const ids = [];
      for (let i = 0; i < 10; i++) {
        ids.push(await insertDeck({ owner: OWNER, trashedAt: SAME_MOMENT }));
      }
      for (let i = 1; i <= 5; i++) {
        ids.push(
          await insertDeck({
            owner: OWNER,
            trashedAt: `2026-10-01 12:00:01.00000${i}+00`,
          }),
        );
      }
      for (let i = 0; i < 8; i++) {
        ids.push(
          await insertDeck({
            owner: OWNER,
            trashedAt: `2026-09-${10 + i} 08:00:00+00`,
          }),
        );
      }
      // Not the owner's: under the narrowest predicate these are left out.
      await insertDeck({ owner: OUTSIDER, trashedAt: SAME_MOMENT });

      const pages = await walk(OWNER, 5);
      assert.deepEqual(
        pages.map((p) => p.length),
        [5, 5, 5, 5, 3],
      );
      const seen = pages.flat();
      assert.equal(new Set(seen).size, seen.length, 'no deck twice');
      assert.deepEqual([...seen].sort(), [...ids].sort(), 'no deck skipped');
      assert.deepEqual(
        seen,
        (await contractOrder(orgA)).filter((id) => ids.includes(id)),
      );
    });

    it('3: a deck trashed between pages does not move page 2', async () => {
      for (let i = 0; i < 9; i++) {
        await insertDeck({
          owner: OWNER,
          trashedAt: `2026-09-${10 + i} 08:00:00+00`,
        });
      }
      const first = await trashRoute('?limit=3', OWNER);
      const page2 = `?limit=3&cursor=${encodeURIComponent(first.body.nextCursor)}`;
      const before = await trashRoute(page2, OWNER);
      await insertDeck({
        owner: OWNER,
        trashedAt: '2026-10-22 09:00:00.000001+00',
      });
      const afterTrash = await trashRoute(page2, OWNER);
      assert.deepEqual(afterTrash.body, before.body);
    });

    it('4: a cursor from org A used in org B only shows B decks', async () => {
      const idsA = [];
      for (let i = 0; i < 6; i++) {
        idsA.push(
          await insertDeck({
            owner: OWNER,
            trashedAt: `2026-09-${10 + i} 08:00:00+00`,
          }),
        );
      }
      const idsB = [];
      for (const trashedAt of [
        '2026-09-30 00:00:00+00',
        '2026-09-11 00:00:00+00',
        '2026-08-01 00:00:00+00',
      ]) {
        idsB.push(
          await insertDeck({ organizationId: orgB, owner: OWNER, trashedAt }),
        );
      }
      const first = await trashRoute('?limit=2', ADMIN);
      const inB = await trashRoute(
        `?limit=100&cursor=${encodeURIComponent(first.body.nextCursor)}`,
        ADMIN,
        orgB,
      );
      assert.equal(inB.status, 200);
      assert.ok(inB.body.presentations.length > 0, 'the position applies');
      for (const p of inB.body.presentations) {
        assert.ok(idsB.includes(p.id), 'only B decks');
        assert.ok(!idsA.includes(p.id), 'never an A deck');
      }
      assert.deepEqual((await walk(ADMIN, 2, orgB)).flat(), idsB);
    });

    it('5: the route refuses offset, a wild limit, a broken cursor and a cursor of another list', async () => {
      for (let i = 0; i < 3; i++) await insertDeck({ owner: OWNER });
      await insertDeck({ owner: OWNER, trashedAt: null });
      await insertDeck({ owner: OWNER, trashedAt: null });
      const trash = await trashRoute('?limit=1', OWNER);
      assert.ok(trash.body.nextCursor);

      const res = createMockRes();
      await handlePresentations({
        req: { method: 'GET', headers: {}, socket: {} },
        res,
        url: new URL('http://deck.example/api/presentations?limit=1'),
        repoRoot: process.cwd(),
        storageScope: scopeOf(orgA, OWNER),
        authedUser: OWNER,
      });
      const homeCursor = res.json().nextCursor;
      assert.ok(homeCursor);

      for (const [query, field] of [
        ['?offset=1', 'offset'],
        ['?limit=0', 'limit'],
        ['?limit=101', 'limit'],
        ['?limit=abc', 'limit'],
        ['?cursor=broken', 'cursor'],
        [`?cursor=${encodeURIComponent(homeCursor)}`, 'cursor'],
      ]) {
        const { status, body } = await trashRoute(query, OWNER);
        assert.equal(status, 400, query);
        assert.equal(body.error, 'invalid', query);
        assert.equal(body.details.field, field, query);
        if (field === 'offset') assert.equal(body.details.use, 'cursor');
      }
    });

    it('migration 097 adds the trash keyset index, idempotently both ways', async () => {
      const runInTx = (fn) => db.transaction().execute((trx) => fn(trx));
      const exists = async () =>
        (
          await sql`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_presentations_trash_keyset'`.execute(
            db,
          )
        ).rows.length === 1;
      try {
        await runInTx(migrate097Down);
        await runInTx(migrate097Down);
        assert.equal(await exists(), false);
        await runInTx(migrate097Up);
        await runInTx(migrate097Up);
        assert.equal(await exists(), true);
      } finally {
        await runInTx(migrate097Up);
      }
    });

    it('the page query walks idx_presentations_trash_keyset without a sort (10 000 trashed decks)', async () => {
      await sql`
      INSERT INTO presentations
        (id, organization_id, title, owner_user_id, owner_email, created_by_user_id,
         modified_at, trashed_at, trashed_by_user_id)
      SELECT gen_random_uuid(), ${orgA}, 'bulk',
        CASE WHEN g % 7 = 0 THEN ${OWNER.id}::uuid ELSE ${OUTSIDER.id}::uuid END,
        'bulk@example.com',
        CASE WHEN g % 11 = 0 THEN ${OWNER.id}::uuid ELSE ${OUTSIDER.id}::uuid END,
        timestamptz '2026-01-01',
        CASE WHEN g % 2 = 0 THEN timestamptz '2026-01-01' + (g * interval '1 minute') END,
        CASE WHEN g % 13 = 0 THEN ${OWNER.id}::uuid END
      FROM generate_series(1, 20000) AS g
    `.execute(db);
      await sql`ANALYZE presentations`.execute(db);

      const plans = {};
      for (const [label, userId] of [
        ['admin', null],
        ['owner', OWNER.id],
      ]) {
        const page = keysetPage(__trashList.trashListQuery(db, orgA, userId), {
          column: 'trashed_at',
          after: { value: '2026-01-04 00:00:00+00', id: crypto.randomUUID() },
          limit: 50,
        }).compile();
        const plan = await db.executeQuery(
          CompiledQuery.raw(`EXPLAIN ${page.sql}`, [...page.parameters]),
        );
        plans[label] = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
      }
      for (const [label, text] of Object.entries(plans)) {
        assert.match(
          text,
          /idx_presentations_trash_keyset/,
          `${label}\n${text}`,
        );
        assert.doesNotMatch(text, /\bSort\b/, `${label}\n${text}`);
      }
      if (process.env.DECK_LIST_PRINT_PLANS) {
        console.log(
          Object.entries(plans)
            .map(([k, v]) => `-- ${k}\n${v}`)
            .join('\n\n'),
        );
      }
    });
  },
);
