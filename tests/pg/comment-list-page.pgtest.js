/**
 * The comment lists on the list-page contract, against real PostgreSQL (B824,
 * D358).
 *
 * Two lists, one contract (`{ limit, cursor }` in, `{ comments, nextCursor }`
 * out, order `(created_at desc, id desc)`):
 *
 *  - **a deck's comments** (`listComments` in server/services/comments.js) on
 *    the internal route, v1, MCP `list_comments` and the share-link guest. A
 *    page counts threads, each with all its replies; with `includeReplies` it
 *    counts comments. Each surface keeps its own gate: the reader of the deck,
 *    or the guest of a link to it;
 *  - **the recent comments across decks** (MCP `list_recent_comments`). It used
 *    to read the actor's whole deck list in JavaScript and send it back as
 *    `IN (...)`; now the deck a comment sits on must be on the reader's list
 *    in the query (`deckListedCondition`, server/storage/presentations/
 *    deck-list.js). Two spellings of one rule need a gate:
 *
 *    **parity**: over comments on every combination of visibility, owner,
 *    maker and collaborator row (active, revoked), plus a trashed deck, a deck
 *    in another organization and an owner whose address changed, the list
 *    equals "the top-level comments on the decks `listDecks` lists, without
 *    the decks that carry no comments" for every reader and every ownership,
 *    with sharing on and off, page by page.
 *
 * And the six checks every list carries (brief `db-level-pagination.md`
 * § Checks): completeness, order, stability, org isolation, refusal and full
 * pages; plus migration 100 (NOT NULL backfill, two keyset indexes) and an
 * `EXPLAIN` on 10 000 comments showing each list walks its index without a
 * sort.
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
import { handlePresentations } from '../../server/routes/api/presentations/index.js';
import { handleComments as handleV1Comments } from '../../server/routes/public-api/v1/comments.js';
import { McpServer } from '../../server/mcp/protocol.js';
import { registerTools } from '../../server/mcp/tools.js';
import {
  listComments,
  listRecentComments,
} from '../../server/services/comments.js';
import { listReader } from '../../server/services/presentations.js';
import {
  deckListedCondition,
  listDecks,
} from '../../server/storage/presentations/index.js';
import { keysetPage } from '../../server/storage/keyset.js';
import { presentationCommentsEnabled } from '../../server/utils/presentation-authz/index.js';
import {
  down as migrate100Down,
  up as migrate100Up,
} from '../../server/db/migrations/100_comment_list_keyset.js';

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
// Writes every comment, so authorship never decides what a reader lists.
const REVIEWER = person('reviewer');
// Owns a deck stamped with the address it had before it changed.
const RENAMED = { ...person('renamed'), email: 'renamed-now@example.com' };
const RENAMED_BEFORE = 'renamed-before@example.com';

const OWNERSHIPS = ['collection', 'owned', 'shared', 'all'];

pgDescribe('comment lists on the list-page contract (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let orgA;
  let orgB;
  const sandboxBefore = process.env.SANDBOX_MODE;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    if (sandboxBefore === undefined) delete process.env.SANDBOX_MODE;
    else process.env.SANDBOX_MODE = sandboxBefore;
    await closeTestDb(db);
  });

  beforeEach(async () => {
    delete process.env.SANDBOX_MODE;
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
        [OWNER, MAKER, COLLAB, OUTSIDER, REVIEWER, RENAMED].map((p) => ({
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
  const withOrg = (actor, organizationId = orgA) => ({
    ...actor,
    organizationId,
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
        title: `Deck ${id.slice(0, 4)}`,
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

  /** Insert one comment and return its id. */
  async function insertComment({
    presentationId,
    organizationId = orgA,
    parentId = null,
    createdAt = SAME_MOMENT,
    author = REVIEWER,
    status = 'open',
  }) {
    const id = crypto.randomUUID();
    await db
      .insertInto('presentation_comments')
      .values({
        id,
        presentation_id: presentationId,
        organization_id: organizationId,
        parent_id: parentId,
        author_email: author.email,
        author_name: author.name,
        author_user_id: author.id ?? null,
        body: 'A remark',
        status,
        created_at: createdAt,
        updated_at: createdAt,
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
   * collaborator states = 54 decks in org A, plus a renamed owner's deck, a
   * trashed deck and an org B deck. Each deck gets two top-level comments
   * (one resolved) and a reply, all within a few microseconds of each other.
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
              makerEmail: makerKind === 'null' ? MAKER.email : maker?.email,
            });
            if (collab !== 'none') {
              await invite(id, COLLAB, { revoked: collab === 'revoked' });
            }
            decks.push([id, orgA]);
          }
        }
      }
    }
    decks.push([
      await insertDeck({
        owner: RENAMED,
        ownerEmail: RENAMED_BEFORE,
        makerEmail: RENAMED_BEFORE,
      }),
      orgA,
    ]);
    const trashed = await insertDeck({ owner: OWNER, trashed: true });
    await invite(trashed, COLLAB);
    decks.push([trashed, orgA]);
    decks.push([
      await insertDeck({
        organizationId: orgB,
        owner: OWNER,
        visibility: 'organization',
      }),
      orgB,
    ]);

    let n = 0;
    for (const [presentationId, organizationId] of decks) {
      const first = await insertComment({
        presentationId,
        organizationId,
        createdAt: stamp(n++),
      });
      await insertComment({
        presentationId,
        organizationId,
        createdAt: stamp(n++),
        status: 'resolved',
      });
      await insertComment({
        presentationId,
        organizationId,
        parentId: first,
        createdAt: stamp(n++),
      });
    }
  }

  /** Top-level comments of an organization in the contract's order. */
  async function contractOrder(organizationId = orgA) {
    const rows = await sql`
      SELECT id, presentation_id, status FROM presentation_comments
      WHERE organization_id = ${organizationId} AND parent_id IS NULL
      ORDER BY created_at DESC, id DESC
    `.execute(db);
    return rows.rows;
  }

  /**
   * The reference: what the recent list read before B824 — the reader's whole
   * deck list (`listDecks`, the B820 predicate), minus the decks that carry no
   * comments, then the top-level comments on those decks.
   */
  async function referenceRecent(actor, ownership, { status = 'all' } = {}) {
    const { items } = await listDecks(scopeOf(orgA, actor), {
      reader: await listReader(actor),
      ownership,
    });
    const decks = new Set(
      items.filter(presentationCommentsEnabled).map((deck) => deck.id),
    );
    return (await contractOrder())
      .filter((row) => decks.has(row.presentation_id))
      .filter((row) => status === 'all' || row.status === status)
      .map((row) => row.id);
  }

  /** Walk every page of the recent list through the service. */
  async function walkRecent(actor, input, page = {}, organizationId = orgA) {
    const pages = [];
    let cursor = null;
    for (let guard = 0; guard < 500; guard++) {
      const { items, nextCursor } = await listRecentComments(
        scopeOf(organizationId, actor),
        { actor },
        input,
        cursor ? { ...page, cursor } : page,
      );
      pages.push(items.map(({ comment }) => comment.id));
      cursor = nextCursor;
      if (cursor === null) return pages;
    }
    throw new Error('the list never ended');
  }

  /** GET the internal deck comments route as `actor`. */
  async function getInternal(deckId, params, actor = OWNER) {
    const res = createMockRes();
    const search = new URLSearchParams(params).toString();
    await handlePresentations({
      repoRoot: process.cwd(),
      storageScope: scopeOf(orgA, actor),
      authedUser: withOrg(actor),
      req: { method: 'GET', headers: {} },
      res,
      url: new URL(`http://x/api/presentations/${deckId}/comments?${search}`),
    });
    return { status: res.statusCode, body: res.json() };
  }

  /** GET the v1 deck comments route with OWNER's key. */
  async function getV1(deckId, params) {
    const res = createMockRes();
    const search = new URLSearchParams(params).toString();
    await handleV1Comments({
      repoRoot: process.cwd(),
      req: { method: 'GET', headers: {} },
      res,
      url: new URL(
        `http://x/api/v1/presentations/${deckId}/comments?${search}`,
      ),
      storageScope: scopeOf(orgA, OWNER),
      apiKey: {
        id: 'key-1',
        tier: 'free',
        ownerEmail: OWNER.email,
        permissions: ['read', 'comments:read'],
        organizationId: orgA,
      },
      authedUser: withOrg(OWNER),
    });
    return { status: res.statusCode, body: res.json() };
  }

  /** Call an MCP tool as OWNER. */
  function mcp(tool, args, organizationId = orgA) {
    const server = new McpServer();
    registerTools(server, { defaultOwnerEmail: OWNER.email });
    return server.tools
      .get(tool)
      .handler(args, { ownerEmail: OWNER.email, organizationId });
  }

  /** Walk a page-at-a-time reader until `nextCursor` is null. */
  async function walk(readPage) {
    const pages = [];
    let cursor = null;
    for (let guard = 0; guard < 500; guard++) {
      const { ids, nextCursor } = await readPage(cursor);
      pages.push(ids);
      cursor = nextCursor;
      if (cursor === null) return pages;
    }
    throw new Error('the list never ended');
  }

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

  it('parity: the recent list equals the comments on the decks listDecks lists, for every reader and ownership, sharing on and off, in full pages', async () => {
    await seedMatrix();
    for (const sandbox of [false, true]) {
      if (sandbox) process.env.SANDBOX_MODE = 'true';
      else delete process.env.SANDBOX_MODE;
      for (const [label, actor] of READERS()) {
        for (const ownership of OWNERSHIPS) {
          const what = `${label} / ${ownership} / sandbox ${sandbox}`;
          const expected = await referenceRecent(actor, ownership);
          const pages = await walkRecent(actor, { ownership }, { limit: 7 });
          for (const page of pages.slice(0, -1)) {
            assert.equal(page.length, 7, `${what}: a full page`);
          }
          assert.deepEqual(pages.flat(), expected, what);
        }
      }
    }
  });

  it('parity holds under the status filter, and the operator never reads org B or the trash', async () => {
    await seedMatrix();
    for (const [label, actor] of READERS()) {
      for (const status of ['open', 'resolved']) {
        assert.deepEqual(
          (await walkRecent(actor, { ownership: 'all', status })).flat(),
          await referenceRecent(actor, 'all', { status }),
          `${label} / ${status}`,
        );
      }
    }
    const operator = (
      await walkRecent(
        { email: null, unrestricted: true },
        { ownership: 'all' },
      )
    ).flat();
    const decks = await db
      .selectFrom('presentation_comments as c')
      .innerJoin('presentations as p', 'p.id', 'c.presentation_id')
      .select(['p.organization_id', 'p.trashed_at'])
      .where('c.id', 'in', operator)
      .execute();
    for (const deck of decks) {
      assert.equal(deck.organization_id, orgA, 'never an org B deck');
      assert.equal(deck.trashed_at, null, 'never a trashed deck');
    }
  });

  it('1+2+6 (recent): every listed comment once, in order, full pages for a narrow reader', async () => {
    // Twelve decks; MAKER lists three. Comments interleave across decks, so a
    // filter after the LIMIT would leave pages short.
    const listed = [];
    const decks = [];
    for (let i = 0; i < 12; i++) {
      const id = await insertDeck({
        owner: OWNER,
        maker: i % 4 === 0 ? MAKER : OWNER,
      });
      decks.push(id);
      if (i % 4 === 0) listed.push(id);
    }
    let n = 0;
    for (let round = 0; round < 3; round++) {
      for (const id of decks) {
        await insertComment({ presentationId: id, createdAt: stamp(n++) });
      }
    }
    for (let i = 0; i < 10; i++) {
      await insertComment({ presentationId: listed[0] });
    }

    const pages = await walkRecent(
      withOrg(MAKER),
      { ownership: 'owned' },
      { limit: 4 },
    );
    const expected = (await contractOrder())
      .filter((row) => listed.includes(row.presentation_id))
      .map((row) => row.id);
    assert.equal(expected.length, 3 * 3 + 10);
    assert.deepEqual(
      pages.map((page) => page.length),
      [4, 4, 4, 4, 3],
    );
    assert.equal(new Set(pages.flat()).size, expected.length, 'no row twice');
    assert.deepEqual(pages.flat(), expected);
  });

  it('1+2+6 (one deck): every thread once with all its replies, in order, on the internal route, v1 and MCP', async () => {
    const deck = await insertDeck({ owner: OWNER });
    const threads = [];
    for (let n = 0; n < 13; n++) {
      threads.push(
        await insertComment({ presentationId: deck, createdAt: stamp(n) }),
      );
    }
    // Ten threads at the same microsecond.
    for (let i = 0; i < 10; i++) {
      threads.push(await insertComment({ presentationId: deck }));
    }
    const replies = new Map();
    for (const [i, parentId] of threads.entries()) {
      const ids = [];
      for (let r = 0; r < i % 3; r++) {
        ids.push(
          await insertComment({
            presentationId: deck,
            parentId,
            createdAt: `2026-10-03 00:00:0${r}+00`,
          }),
        );
      }
      replies.set(parentId, ids);
    }
    const expected = (await contractOrder()).map((row) => row.id);
    assert.equal(expected.length, 23);

    const internal = await walk(async (cursor) => {
      const { status, body } = await getInternal(deck, {
        limit: '5',
        ...(cursor ? { cursor } : {}),
      });
      assert.equal(status, 200, JSON.stringify(body));
      for (const thread of body.comments) {
        assert.deepEqual(
          thread.replies.map((reply) => reply.id),
          replies.get(thread.id),
          'every reply on the thread’s page',
        );
      }
      assert.equal(typeof body.openCount, 'number');
      return {
        ids: body.comments.map((c) => c.id),
        nextCursor: body.nextCursor,
      };
    });
    assert.deepEqual(
      internal.map((page) => page.length),
      [5, 5, 5, 5, 3],
    );
    assert.deepEqual(internal.flat(), expected);

    const v1 = await walk(async (cursor) => {
      const { status, body } = await getV1(deck, {
        limit: '6',
        ...(cursor ? { cursor } : {}),
      });
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal('total' in body, false, 'no total');
      return {
        ids: body.comments.map((c) => c.id),
        nextCursor: body.nextCursor,
      };
    });
    assert.deepEqual(v1.flat(), expected);

    // With includeReplies a page counts comments, replies included.
    const everyRow = (
      await sql`
        SELECT id FROM presentation_comments WHERE presentation_id = ${deck}
        ORDER BY created_at DESC, id DESC
      `.execute(db)
    ).rows.map((row) => row.id);
    const flat = await walk(async (cursor) => {
      const result = await mcp('list_comments', {
        presentationId: deck,
        includeReplies: true,
        limit: 8,
        ...(cursor ? { cursor } : {}),
      });
      assert.equal('total' in result, false, 'no total');
      return {
        ids: result.comments.map((c) => c.id),
        nextCursor: result.nextCursor,
      };
    });
    for (const page of flat.slice(0, -1)) assert.equal(page.length, 8);
    assert.deepEqual(flat.flat(), everyRow);
  });

  it('2: the cursor keeps microseconds (comments inside one millisecond), on both lists', async () => {
    const deck = await insertDeck({ owner: OWNER });
    const ids = [];
    for (let i = 1; i <= 6; i++) {
      ids.push(
        await insertComment({
          presentationId: deck,
          createdAt: `2026-10-01 12:00:01.00000${i}+00`,
        }),
      );
    }
    const oneDeck = await walk(async (cursor) => {
      const { body } = await getInternal(deck, {
        limit: '1',
        ...(cursor ? { cursor } : {}),
      });
      return {
        ids: body.comments.map((c) => c.id),
        nextCursor: body.nextCursor,
      };
    });
    assert.deepEqual(oneDeck.flat(), [...ids].reverse());
    const recent = await walkRecent(
      withOrg(OWNER),
      { ownership: 'owned' },
      { limit: 1 },
    );
    assert.deepEqual(recent.flat(), [...ids].reverse());
  });

  it('3: a comment added at the top between pages does not move page 2, on both lists', async () => {
    const deck = await insertDeck({ owner: OWNER });
    for (let n = 0; n < 12; n++) {
      await insertComment({ presentationId: deck, createdAt: stamp(n) });
    }
    const first = await getInternal(deck, { limit: '5' });
    const cursor = first.body.nextCursor;
    const recentFirst = await listRecentComments(
      scopeOf(orgA, OWNER),
      { actor: withOrg(OWNER) },
      { ownership: 'owned' },
      { limit: 5 },
    );
    const page2 = await getInternal(deck, { limit: '5', cursor });
    const recentPage2 = await listRecentComments(
      scopeOf(orgA, OWNER),
      { actor: withOrg(OWNER) },
      { ownership: 'owned' },
      { limit: 5, cursor: recentFirst.nextCursor },
    );

    await insertComment({
      presentationId: deck,
      createdAt: '2026-10-22 09:00:00.000001+00',
    });
    const again = await getInternal(deck, { limit: '5', cursor });
    assert.deepEqual(
      again.body.comments.map((c) => c.id),
      page2.body.comments.map((c) => c.id),
    );
    assert.equal(again.body.nextCursor, page2.body.nextCursor);
    const recentAgain = await listRecentComments(
      scopeOf(orgA, OWNER),
      { actor: withOrg(OWNER) },
      { ownership: 'owned' },
      { limit: 5, cursor: recentFirst.nextCursor },
    );
    assert.deepEqual(
      recentAgain.items.map(({ comment }) => comment.id),
      recentPage2.items.map(({ comment }) => comment.id),
    );
  });

  it('4: a cursor from org A used in org B only shows B comments', async () => {
    const deckA = await insertDeck({ owner: OWNER });
    const idsA = [];
    for (let n = 0; n < 12; n++) {
      idsA.push(
        await insertComment({ presentationId: deckA, createdAt: stamp(n) }),
      );
    }
    const deckB = await insertDeck({ organizationId: orgB, owner: OWNER });
    const idsB = [];
    for (const createdAt of [
      '2026-10-05 00:00:00+00',
      SAME_MOMENT,
      '2026-09-15 00:00:00+00',
    ]) {
      idsB.push(
        await insertComment({
          presentationId: deckB,
          organizationId: orgB,
          createdAt,
        }),
      );
    }

    const first = await mcp('list_recent_comments', {
      ownership: 'owned',
      limit: 5,
    });
    assert.ok(first.nextCursor);
    const inB = await mcp(
      'list_recent_comments',
      { ownership: 'owned', limit: 100, cursor: first.nextCursor },
      orgB,
    );
    const shown = inB.comments.map((c) => c.id);
    assert.ok(shown.length > 0, 'the position still applies in B');
    for (const id of shown) {
      assert.ok(idsB.includes(id), 'only B comments');
      assert.ok(!idsA.includes(id), 'never an A comment');
    }

    // The deck list cannot cross either: org A's deck read in org B's scope.
    await assert.rejects(
      listComments(
        scopeOf(orgB, OWNER),
        { actor: withOrg(OWNER, orgB) },
        { presentationId: deckA },
      ),
      (err) => err.statusCode === 404 || err.status === 404,
    );
  });

  it('5: limit, offset and foreign cursors are refused on every surface', async () => {
    const deck = await insertDeck({ owner: OWNER });
    const other = await insertDeck({ owner: OWNER });
    for (let n = 0; n < 6; n++) {
      await insertComment({ presentationId: deck, createdAt: stamp(n) });
      await insertComment({ presentationId: other, createdAt: stamp(n) });
    }
    const firstPage = await getInternal(deck, { limit: '2' });
    const fromDeck = firstPage.body.nextCursor;
    const refusals = [
      [{ offset: '0' }, 'offset'],
      [{ limit: '0' }, 'limit'],
      [{ limit: '101' }, 'limit'],
      [{ limit: 'abc' }, 'limit'],
      [{ cursor: 'not-a-cursor' }, 'cursor'],
      // Made under other filters, or on another deck.
      [{ limit: '2', status: 'open', cursor: fromDeck }, 'cursor'],
    ];
    for (const [params, field] of refusals) {
      for (const [label, get] of [
        ['internal', (p) => getInternal(deck, p)],
        ['v1', (p) => getV1(deck, p)],
      ]) {
        const { status, body } = await get(params);
        assert.equal(status, 400, `${label} ${JSON.stringify(params)}`);
        assert.equal(body.error, 'invalid');
        assert.equal(body.details.field, field);
        if (field === 'offset') assert.equal(body.details.use, 'cursor');
      }
    }
    const otherDeck = await getInternal(other, {
      limit: '2',
      cursor: fromDeck,
    });
    assert.equal(otherDeck.status, 400, 'a cursor of another deck');
    assert.equal(otherDeck.body.details.field, 'cursor');

    const recent = await mcp('list_recent_comments', {
      ownership: 'owned',
      limit: 2,
    });
    for (const [tool, args, field] of [
      ['list_comments', { presentationId: deck, limit: 0 }, 'limit'],
      ['list_comments', { presentationId: deck, offset: 2 }, 'offset'],
      // A cursor of the recent list is no cursor of a deck.
      [
        'list_comments',
        { presentationId: deck, cursor: recent.nextCursor },
        'cursor',
      ],
      ['list_recent_comments', { limit: 101 }, 'limit'],
      ['list_recent_comments', { offset: 0 }, 'offset'],
      [
        'list_recent_comments',
        { ownership: 'all', cursor: recent.nextCursor },
        'cursor',
      ],
      ['list_recent_comments', { ownership: 'mine' }, 'ownership'],
    ]) {
      await assert.rejects(
        mcp(tool, args),
        (err) => err.code === 'invalid' && err.details?.field === field,
        `${tool} ${JSON.stringify(args)}`,
      );
    }
  });

  it('the guest keeps the link’s gate: pages of that deck, and no other deck', async () => {
    const deck = await insertDeck({ owner: OWNER });
    const other = await insertDeck({
      owner: OWNER,
      visibility: 'organization',
    });
    for (let n = 0; n < 7; n++) {
      await insertComment({ presentationId: deck, createdAt: stamp(n) });
      await insertComment({ presentationId: other, createdAt: stamp(n) });
    }
    const guestOn = (presentationId) => ({
      guest: { id: crypto.randomUUID(), verifiedAt: SAME_MOMENT },
      shareLink: { presentationId, permission: 'comment' },
    });
    const scope = { ...scopeOf(orgA), actorEmail: null };
    const pages = await walk(async (cursor) => {
      const { comments, nextCursor } = await listComments(
        scope,
        guestOn(deck),
        { presentationId: deck },
        { limit: '3', ...(cursor ? { cursor } : {}) },
      );
      return { ids: comments.map((c) => c.id), nextCursor };
    });
    assert.deepEqual(
      pages.map((page) => page.length),
      [3, 3, 1],
    );
    const onDeck = (await contractOrder())
      .filter((row) => row.presentation_id === deck)
      .map((row) => row.id);
    assert.deepEqual(pages.flat(), onDeck);

    await assert.rejects(
      listComments(scope, guestOn(deck), { presentationId: other }),
      (err) => [403, 404].includes(err.statusCode ?? err.status),
    );
  });

  it('migration 100 backfills a NULL created_at and makes the column NOT NULL', async () => {
    const deck = await insertDeck({ owner: OWNER });
    const runInTx = (fn) => db.transaction().execute((trx) => fn(trx));
    await runInTx(migrate100Down);
    try {
      const id = await insertComment({ presentationId: deck, createdAt: null });
      await runInTx(migrate100Up);
      const row = await sql`
        SELECT created_at IS NOT NULL AS stamped
        FROM presentation_comments WHERE id = ${id}
      `.execute(db);
      assert.equal(row.rows[0].stamped, true, 'the NULL is backfilled');
      await assert.rejects(
        insertComment({ presentationId: deck, createdAt: null }),
        /null value|not-null/i,
        'NOT NULL holds',
      );
      await runInTx(migrate100Up);
    } finally {
      await runInTx(migrate100Up);
    }
  });

  it('each list walks its keyset index without a sort (10 000 comments)', async () => {
    const decks = [];
    for (let i = 0; i < 20; i++) {
      decks.push(
        await insertDeck({
          owner: i % 2 ? OWNER : OUTSIDER,
          visibility: i % 3 ? 'private' : 'organization',
        }),
      );
    }
    await sql`
      INSERT INTO presentation_comments
        (organization_id, presentation_id, author_email, body, created_at)
      SELECT ${orgA}, (${sql.val(decks)}::uuid[])[1 + g % 20],
        ${REVIEWER.email}, 'x',
        timestamptz '2026-01-01' + (g * interval '1 minute')
      FROM generate_series(1, 10000) AS g
    `.execute(db);
    await sql`ANALYZE presentation_comments`.execute(db);
    await sql`ANALYZE presentations`.execute(db);

    const after = {
      value: '2026-01-04 00:00:00+00',
      id: crypto.randomUUID(),
    };
    const explain = async (query) => {
      const compiled = query.compile();
      const plan = await db.executeQuery(
        CompiledQuery.raw(`EXPLAIN ${compiled.sql}`, [...compiled.parameters]),
      );
      return plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    };

    const oneDeck = await explain(
      keysetPage(
        db
          .selectFrom('presentation_comments')
          .selectAll()
          .where('presentation_id', '=', decks[0])
          .where('organization_id', '=', orgA)
          .where('parent_id', 'is', null),
        { column: 'created_at', after, limit: 20 },
      ),
    );
    assert.match(oneDeck, /idx_comments_deck_keyset/, oneDeck);
    assert.doesNotMatch(oneDeck, /\bSort\b/, oneDeck);

    const reader = await listReader(withOrg(OWNER));
    const recent = await explain(
      keysetPage(
        db
          .selectFrom('presentation_comments')
          .innerJoin(
            'presentations',
            'presentations.id',
            'presentation_comments.presentation_id',
          )
          .selectAll('presentation_comments')
          .where('presentation_comments.organization_id', '=', orgA)
          .where('presentation_comments.parent_id', 'is', null)
          .where((eb) =>
            deckListedCondition(scopeOf(orgA), eb, {
              reader,
              ownership: 'all',
            }),
          ),
        {
          column: 'presentation_comments.created_at',
          idColumn: 'presentation_comments.id',
          after,
          limit: 20,
        },
      ),
    );
    assert.match(recent, /idx_comments_org_keyset/, recent);
    assert.doesNotMatch(recent, /\bSort\b/, recent);
  });
});
