/**
 * The activity feed on the list-page contract, with the read right in the
 * query, against real PostgreSQL (B823, D358).
 *
 * The feed used to page in SQL with `LIMIT/OFFSET` and drop the events on
 * decks the reader may not open afterwards, so a page came back shorter than
 * asked while there was more, and `total` counted events the reader could not
 * see. Now `listActivityEvents` (server/storage/activity-events.js) asks "may
 * this reader open the deck" in the query (`deckReadableExpression`,
 * server/storage/presentations/deck-list.js), and the page is a keyset page
 * `(created_at desc, id desc)`. Two spellings of one rule need a gate:
 *
 *  - **parity**: over events on every combination of visibility, owner, maker
 *    and collaborator row (active, revoked), plus a trashed deck, a deck moved
 *    to another organization, an owner whose address changed and events on no
 *    deck, the feed equals "the event is on no deck, or
 *    `loadPresentationForActor` hands its deck out" for every reader, page by
 *    page;
 *
 * and the six checks every list carries (brief `db-level-pagination.md`
 * § Checks), through the real `/api/activity` route:
 *
 *  1. completeness and 2. order: every visible event exactly once, in
 *     `(created_at desc, id desc)`, across events at one identical microsecond
 *     and events a microsecond apart;
 *  3. stability: an event added at the top between pages does not move
 *     page 2;
 *  4. org isolation: a cursor from org A used in org B shows only B events;
 *  5. refusal: `offset`, an out-of-range `limit`, a cursor from other
 *     filters, also on `/api/home`;
 *  6. full pages: every page but the last has exactly `limit` events for a
 *     reader who may open only a few of the decks.
 *
 * Plus migration 099 (NOT NULL backfill, keyset index) and an `EXPLAIN` on
 * 10 000 events showing the page walks that index without a sort.
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
import {
  getEnrichedActivity,
  handleActivity,
  parseActivityQuery,
} from '../../server/routes/api/activity.js';
import { handleHome } from '../../server/routes/api/home.js';
import {
  listReader,
  loadPresentationForActor,
} from '../../server/services/presentations.js';
import { deckReadableExpression } from '../../server/storage/presentations/index.js';
import { keysetPage } from '../../server/storage/keyset.js';
import {
  down as migrate099Down,
  up as migrate099Up,
} from '../../server/db/migrations/099_activity_list_keyset.js';

const SAME_MOMENT = '2026-10-01 12:00:00.123456+00';

const person = (name) => ({
  id: crypto.randomUUID(),
  email: `${name}@example.com`,
  name,
});
const OWNER = person('owner');
const MAKER = person('maker');
const COLLAB = person('collab');
const OUTSIDER = person('outsider');
// The one who acted: every event is someone else's, so `excludeSelf` never
// hides one from the readers below.
const ACTOR = person('actor');
// Owns a deck stamped with the address it had before it changed.
const RENAMED = { ...person('renamed'), email: 'renamed-now@example.com' };
const RENAMED_BEFORE = 'renamed-before@example.com';

pgDescribe('activity feed on the list-page contract (real PostgreSQL)', () => {
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
        [OWNER, MAKER, COLLAB, OUTSIDER, ACTOR, RENAMED].map((p) => ({
          id: p.id,
          organization_id: orgA,
          email: p.email,
          name: p.name,
          role: 'user',
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

  /** Insert one deck row and return its id. */
  async function insertDeck({
    organizationId = orgA,
    visibility = 'private',
    owner = null,
    ownerEmail = owner?.email ?? null,
    maker = owner,
    makerEmail = maker?.email ?? null,
    trashed = false,
  } = {}) {
    const id = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id,
        organization_id: organizationId,
        title: 'Deck',
        visibility,
        owner_user_id: owner?.id ?? null,
        owner_email: ownerEmail,
        created_by_user_id: maker?.id ?? null,
        created_by: makerEmail,
        trashed_at: trashed ? SAME_MOMENT : null,
      })
      .execute();
    return id;
  }

  async function invite(presentationId, who, { revoked = false } = {}) {
    await db
      .insertInto('presentation_collaborators')
      .values({
        presentation_id: presentationId,
        organization_id: orgA,
        user_email: who.email,
        user_id: who.id ?? null,
        permission: 'view',
        invited_by: OWNER.email,
        revoked_at: revoked ? '2026-10-02 00:00:00+00' : null,
      })
      .execute();
  }

  /** Insert one activity event and return its id. */
  async function insertEvent({
    organizationId = orgA,
    presentationId = null,
    createdAt = SAME_MOMENT,
    actor = ACTOR,
  } = {}) {
    const id = crypto.randomUUID();
    await db
      .insertInto('activity_events')
      .values({
        id,
        organization_id: organizationId,
        event_type: 'presentation.updated',
        entity_type: 'presentation',
        entity_id: presentationId ?? crypto.randomUUID(),
        presentation_id: presentationId,
        actor_email: actor.email,
        actor_name: actor.name,
        created_at: createdAt,
      })
      .execute();
    return id;
  }

  /** The n-th of a run of timestamps: every third one identical. */
  const stamp = (n) =>
    n % 3 === 0
      ? SAME_MOMENT
      : `2026-10-01 12:00:00.12${String(3000 + n).padStart(4, '0')}+00`;

  /**
   * The parity fixture: 2 visibilities × 3 owners × 3 makers × 3
   * collaborator states = 54 decks in org A with two events each, plus the
   * special decks and six events on no deck, all within a few microseconds of
   * each other (so the tiebreaker and precision matter). Org B gets events of
   * its own.
   */
  async function seedMatrix() {
    const decks = [];
    for (const visibility of ['private', 'organization']) {
      for (const owner of [OWNER, OUTSIDER, null]) {
        for (const makerKind of ['owner', 'maker', 'null']) {
          for (const collab of ['none', 'active', 'revoked']) {
            const maker =
              makerKind === 'owner'
                ? owner
                : makerKind === 'maker'
                  ? MAKER
                  : null;
            const id = await insertDeck({
              visibility,
              owner,
              maker,
              // A NULL maker id with the maker's address beside it: the id is
              // the key, the address rescues nothing (D22).
              makerEmail: makerKind === 'null' ? MAKER.email : maker?.email,
            });
            if (collab !== 'none') {
              await invite(id, COLLAB, { revoked: collab === 'revoked' });
            }
            decks.push(id);
          }
        }
      }
    }
    // Owned by the renamed user under the address it had before.
    decks.push(
      await insertDeck({
        owner: RENAMED,
        ownerEmail: RENAMED_BEFORE,
        makerEmail: RENAMED_BEFORE,
      }),
    );
    // In the trash: opening it by id is still a read.
    const trashed = await insertDeck({ owner: OWNER, trashed: true });
    await invite(trashed, COLLAB);
    decks.push(trashed);
    // Moved to org B after the event in org A was written.
    decks.push(
      await insertDeck({
        organizationId: orgB,
        owner: OWNER,
        visibility: 'organization',
      }),
    );

    let n = 0;
    for (const presentationId of decks) {
      for (let i = 0; i < 2; i++) {
        await insertEvent({ presentationId, createdAt: stamp(n++) });
      }
    }
    for (let i = 0; i < 6; i++) await insertEvent({ createdAt: stamp(n++) });
    for (let i = 0; i < 4; i++) {
      await insertEvent({ organizationId: orgB, createdAt: stamp(n++) });
    }
  }

  /** Org A's events in the contract's order, straight from SQL. */
  async function contractOrder(organizationId = orgA) {
    const rows = await sql`
      SELECT id, presentation_id FROM activity_events
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC, id DESC
    `.execute(db);
    return rows.rows;
  }

  /**
   * The by-id reference: an event is visible when it is on no deck, or when
   * `loadPresentationForActor` hands its deck to this reader. This is what
   * the feed decided per event before B823.
   */
  async function referenceFeed(actor) {
    const readable = new Map();
    const visible = [];
    for (const row of await contractOrder()) {
      const pid = row.presentation_id;
      if (pid && !readable.has(pid)) {
        let ok = true;
        try {
          await loadPresentationForActor(scopeOf(orgA, actor), { actor }, pid);
        } catch {
          ok = false;
        }
        readable.set(pid, ok);
      }
      if (!pid || readable.get(pid)) visible.push(row.id);
    }
    return visible;
  }

  /** Walk every page of the feed through the shared page function. */
  async function walkFeed(actor, params, organizationId = orgA) {
    const pages = [];
    let cursor = null;
    for (let guard = 0; guard < 200; guard++) {
      const search = new URLSearchParams(
        cursor ? { ...params, cursor } : params,
      );
      const { events, nextCursor } = await getEnrichedActivity({
        storageScope: scopeOf(organizationId, actor),
        authedUser: actor,
        ...parseActivityQuery(search),
      });
      pages.push(events.map((event) => event.id));
      cursor = nextCursor;
      if (cursor === null) return pages;
    }
    throw new Error('the feed never ended');
  }

  /** GET one route as `actor`. */
  async function getRoute(handler, path, params, actor, organizationId) {
    const res = createMockRes();
    const search = new URLSearchParams(params).toString();
    await handler({
      repoRoot: process.cwd(),
      storageScope: scopeOf(organizationId ?? orgA, actor),
      authedUser: actor,
      req: { method: 'GET', headers: {} },
      res,
      url: new URL(`http://x${path}?${search}`),
    });
    return { status: res.statusCode, body: res.json() };
  }
  const getActivity = (params, actor = OUTSIDER, organizationId) =>
    getRoute(handleActivity, '/api/activity', params, actor, organizationId);

  /** Walk every page of `/api/activity` as `actor`. */
  async function walkRoute(params, actor = OUTSIDER, organizationId) {
    const pages = [];
    let cursor = null;
    for (let guard = 0; guard < 200; guard++) {
      const { status, body } = await getActivity(
        cursor ? { ...params, cursor } : params,
        actor,
        organizationId,
      );
      assert.equal(status, 200, JSON.stringify(body));
      pages.push(body.events.map((event) => event.id));
      cursor = body.nextCursor;
      if (cursor === null) return pages;
    }
    throw new Error('the feed never ended');
  }

  const withOrg = (actor) => ({ ...actor, organizationId: orgA });

  // The readers. An address-only actor is resolved to `users.id` by the feed
  // (listReader) and by the by-id deciders alike.
  const READERS = () => [
    ['owner', withOrg(OWNER)],
    ['maker', withOrg(MAKER)],
    ['collaborator', withOrg(COLLAB)],
    ['outsider', withOrg(OUTSIDER)],
    ['renamed owner (by id)', withOrg(RENAMED)],
    ['renamed owner (address only)', withOrg({ email: RENAMED.email })],
    ['renamed owner (old address)', withOrg({ email: RENAMED_BEFORE })],
    ['collaborator (address only)', withOrg({ email: COLLAB.email })],
    ['auth-off operator', { email: null, unrestricted: true }],
    ['no identity', {}],
  ];

  it('parity: the feed equals "no deck, or loadPresentationForActor hands it out" for every reader, in full pages', async () => {
    await seedMatrix();
    for (const [label, actor] of READERS()) {
      const expected = await referenceFeed(actor);
      const pages = await walkFeed(actor, { limit: '7' });
      for (const page of pages.slice(0, -1)) {
        assert.equal(page.length, 7, `${label}: a full page`);
      }
      assert.deepEqual(pages.flat(), expected, `${label}: paged`);
    }
  });

  it('parity edge cases: the trash, a moved deck, a changed address and events on no deck', async () => {
    await seedMatrix();
    const feed = async (actor) => (await walkFeed(actor, {})).flat();
    const all = await contractOrder();
    const onNoDeck = all.filter((row) => !row.presentation_id);
    const decksOf = async (actor) => {
      const ids = new Set(await feed(actor));
      return new Set(
        all
          .filter((row) => ids.has(row.id) && row.presentation_id)
          .map((row) => row.presentation_id),
      );
    };

    // A reader without identity sees only the events on no deck.
    assert.deepEqual(
      await feed({}),
      onNoDeck.map((row) => row.id),
    );

    // The operator reads every deck still in org A, the trashed one too,
    // never the deck that moved to org B.
    const operator = await decksOf({ email: null, unrestricted: true });
    assert.equal(operator.size, 54 + 2, 'the matrix, renamed and trashed');

    // The renamed owner keeps its deck by id, not by the old address.
    const renamedDecks = await decksOf(withOrg(RENAMED));
    const oldAddressDecks = await decksOf(withOrg({ email: RENAMED_BEFORE }));
    assert.equal(renamedDecks.size - oldAddressDecks.size, 1);

    // The collaborator reaches the trashed private deck through its active
    // row; an outsider does not.
    const [{ id: trashed }] = await db
      .selectFrom('presentations')
      .select('id')
      .where('trashed_at', 'is not', null)
      .execute();
    assert.ok((await decksOf(withOrg(COLLAB))).has(trashed));
    assert.ok(!(await decksOf(withOrg(OUTSIDER))).has(trashed));
  });

  it('1+2+6: every visible event once, in (created_at desc, id desc), full pages for a narrow reader', async () => {
    // Twelve decks; MAKER may open three of them. Each deck gets three events,
    // interleaved, so a filter after the LIMIT would leave pages short.
    const readable = [];
    for (let i = 0; i < 12; i++) {
      const id = await insertDeck({
        owner: OWNER,
        maker: i % 4 === 0 ? MAKER : OWNER,
      });
      if (i % 4 === 0) readable.push(id);
    }
    const decks = await db
      .selectFrom('presentations')
      .select('id')
      .where('organization_id', '=', orgA)
      .execute();
    let n = 0;
    for (let round = 0; round < 3; round++) {
      for (const { id } of decks) {
        await insertEvent({ presentationId: id, createdAt: stamp(n++) });
      }
    }
    // Ten events at the same microsecond on one readable deck.
    for (let i = 0; i < 10; i++) {
      await insertEvent({ presentationId: readable[0] });
    }

    const reader = withOrg(MAKER);
    const pages = await walkRoute({ limit: '4' }, reader);
    const seen = pages.flat();
    const expected = (await contractOrder())
      .filter((row) => readable.includes(row.presentation_id))
      .map((row) => row.id);
    assert.equal(expected.length, 3 * 3 + 10);
    assert.deepEqual(
      pages.map((page) => page.length),
      [4, 4, 4, 4, 3],
      'full pages until the last one',
    );
    assert.equal(new Set(seen).size, seen.length, 'no event twice');
    assert.deepEqual(seen, expected, 'the contract order, nothing skipped');
  });

  it('2: the cursor keeps microseconds (events inside one millisecond)', async () => {
    const ids = [];
    for (let i = 1; i <= 6; i++) {
      ids.push(
        await insertEvent({ createdAt: `2026-10-01 12:00:01.00000${i}+00` }),
      );
    }
    const pages = await walkRoute({ limit: '1' });
    assert.deepEqual(pages.flat(), [...ids].reverse());
  });

  it('3: an event added at the top between pages does not move page 2', async () => {
    for (let n = 0; n < 12; n++) await insertEvent({ createdAt: stamp(n) });
    const first = await getActivity({ limit: '5' });
    const cursor = first.body.nextCursor;
    const before = await getActivity({ limit: '5', cursor });

    await insertEvent({ createdAt: '2026-10-22 09:00:00.000001+00' });
    const afterInsert = await getActivity({ limit: '5', cursor });

    assert.deepEqual(
      afterInsert.body.events.map((event) => event.id),
      before.body.events.map((event) => event.id),
    );
    assert.equal(afterInsert.body.nextCursor, before.body.nextCursor);
  });

  it('4: a cursor from org A used in org B only shows B events', async () => {
    const idsA = [];
    for (let n = 0; n < 12; n++)
      idsA.push(await insertEvent({ createdAt: stamp(n) }));
    const idsB = [];
    for (const createdAt of [
      '2026-10-05 00:00:00+00',
      SAME_MOMENT,
      '2026-09-15 00:00:00+00',
      '2026-08-01 00:00:00+00',
    ]) {
      idsB.push(await insertEvent({ organizationId: orgB, createdAt }));
    }

    const first = await getActivity({ limit: '5' });
    const cursorFromA = first.body.nextCursor;
    assert.ok(cursorFromA);

    const { status, body } = await getActivity(
      { limit: '100', cursor: cursorFromA },
      OUTSIDER,
      orgB,
    );
    assert.equal(status, 200);
    const shown = body.events.map((event) => event.id);
    assert.ok(shown.length > 0, 'the position still applies in B');
    for (const id of shown) {
      assert.ok(idsB.includes(id), 'only B events');
      assert.ok(!idsA.includes(id), 'never an A event');
    }
  });

  it('5: offset, a bad limit and a cursor from other filters are refused, on /api/activity and /api/home', async () => {
    for (let n = 0; n < 6; n++) await insertEvent({ createdAt: stamp(n) });
    const refusals = [
      [{ offset: '0' }, 'offset'],
      [{ limit: '0' }, 'limit'],
      [{ limit: '101' }, 'limit'],
      [{ limit: 'abc' }, 'limit'],
      [{ cursor: 'not-a-cursor' }, 'cursor'],
    ];
    for (const [params, field] of refusals) {
      for (const [handler, path] of [
        [handleActivity, '/api/activity'],
        [handleHome, '/api/home'],
      ]) {
        const { status, body } = await getRoute(
          handler,
          path,
          params,
          OUTSIDER,
        );
        assert.equal(status, 400, `${path} ${JSON.stringify(params)}`);
        assert.equal(body.error, 'invalid');
        assert.equal(body.details.field, field);
        if (field === 'offset') assert.equal(body.details.use, 'cursor');
      }
    }

    // A cursor made with excludeSelf is no cursor without it.
    const first = await getActivity({ limit: '2', excludeSelf: 'true' });
    const refused = await getActivity({
      limit: '2',
      cursor: first.body.nextCursor,
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.details.field, 'cursor');
  });

  it('6: /api/home carries the same page: { events, nextCursor }, own events left out', async () => {
    for (let n = 0; n < 25; n++) await insertEvent({ createdAt: stamp(n) });
    await insertEvent({ actor: OUTSIDER, createdAt: '2026-10-20 00:00:00+00' });
    const { status, body } = await getRoute(
      handleHome,
      '/api/home',
      {},
      OUTSIDER,
    );
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.activity.events.length, 20, 'Home reads 20');
    assert.equal(typeof body.activity.nextCursor, 'string');
    assert.equal('total' in body.activity, false, 'no total');
    for (const event of body.activity.events) {
      assert.notEqual(event.actor?.email, OUTSIDER.email, 'not your own');
    }
  });

  it('migration 099 backfills a NULL created_at and makes the column NOT NULL', async () => {
    const runInTx = (fn) => db.transaction().execute((trx) => fn(trx));
    await runInTx(migrate099Down);
    try {
      const id = await insertEvent({ createdAt: null });
      await runInTx(migrate099Up);
      const row = await sql`
        SELECT created_at IS NOT NULL AS stamped
        FROM activity_events WHERE id = ${id}
      `.execute(db);
      assert.equal(row.rows[0].stamped, true, 'the NULL is backfilled');
      await assert.rejects(
        insertEvent({ createdAt: null }),
        /null value|not-null/i,
        'NOT NULL holds',
      );
      // Idempotent: a second run finds nothing to do.
      await runInTx(migrate099Up);
    } finally {
      // Leave the schema migrated whatever happened above.
      await runInTx(migrate099Up);
    }
  });

  it('the page query walks idx_activity_events_keyset without a sort (10 000 events)', async () => {
    const deck = await insertDeck({ owner: OWNER, visibility: 'organization' });
    await sql`
      INSERT INTO activity_events
        (organization_id, event_type, entity_type, entity_id, presentation_id,
         actor_email, created_at)
      SELECT ${orgA}, 'presentation.updated', 'presentation', ${deck}, ${deck},
        ${ACTOR.email}, timestamptz '2026-01-01' + (g * interval '1 minute')
      FROM generate_series(1, 10000) AS g
    `.execute(db);
    await sql`ANALYZE activity_events`.execute(db);

    const reader = await listReader(withOrg(OUTSIDER));
    const page = keysetPage(
      db
        .selectFrom('activity_events')
        .selectAll()
        .where('organization_id', '=', orgA)
        .where((eb) =>
          eb.or([
            eb('activity_events.presentation_id', 'is', null),
            deckReadableExpression(scopeOf(orgA), eb, {
              reader,
              deckRef: 'activity_events.presentation_id',
            }),
          ]),
        ),
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
    assert.match(text, /idx_activity_events_keyset/, text);
    assert.doesNotMatch(text, /\bSort\b/, text);
  });
});
