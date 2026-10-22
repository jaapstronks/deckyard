/**
 * The deck list in SQL, on the list-page contract, against real PostgreSQL
 * (B820, D358).
 *
 * Who sees which deck used to be decided per row in JavaScript after the
 * whole organization was read (`belongsInCollection`); now it is one query
 * (`listDecks`, server/storage/presentations/deck-list.js) with a keyset page
 * `(modified_at desc, id desc)`. Two spellings of one rule need a gate, and
 * this file is it:
 *
 *  - **parity**: over a fixture of every combination of visibility, owner,
 *    maker, view-only and collaborator row (active, revoked, other org), plus
 *    a trashed deck, a deck in another organization, an owner whose address
 *    changed, a NULL maker id, the auth-off operator and actors without an
 *    identity, the SQL list equals `rows.filter(belongsInCollection)` (and
 *    its `owned`/`shared`/`all` siblings) for every ownership and `viewOnly`,
 *    page by page and unpaged;
 *
 * and the six checks every list carries (brief `db-level-pagination.md`
 * § Checks):
 *
 *  1. completeness and 2. order: every deck exactly once, in
 *     `(modified_at desc, id desc)`, across decks with one identical
 *     microsecond and decks a microsecond apart;
 *  3. stability: a deck changed at the top between pages does not move
 *     page 2;
 *  4. org isolation: a cursor from org A used in org B shows only B decks;
 *  5. refusal: `offset`, an out-of-range `limit`, a cursor from another
 *     filter, through the real v1 route (the rest needs no database:
 *     tests/list-page.test.js, tests/service-layer-presentation-list.test.js);
 *  6. full pages: every page but the last has exactly `limit` decks, also
 *     under the narrowest predicate.
 *
 * Plus migration 096 (NOT NULL backfill, keyset index) and an `EXPLAIN` on
 * 10 000 decks showing the page walks that index without a sort.
 *
 * B821 adds Home's two narrowing filters, `visibility` and `tags`, to the
 * same query (parity against the JavaScript reference, full pages), and
 * drives the internal Home and shared-with-me routes page by page with the
 * six checks.
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
  listPresentationPage,
  listPresentationsForActor,
} from '../../server/services/presentations.js';
import { listPresentations } from '../../server/storage/presentations/index.js';
import { __deckList } from '../../server/storage/presentations/deck-list.js';
import { keysetPage } from '../../server/storage/keyset.js';
import { handlePresentations as handleV1Presentations } from '../../server/routes/public-api/v1/presentations.js';
import { handlePresentations as handleInternalPresentations } from '../../server/routes/api/presentations/index.js';
import { handleCollaborators } from '../../server/routes/api/collaborators.js';
import {
  belongsInCollection,
  isUnrestricted,
} from '../../server/utils/presentation-authz/presentations.js';
import { isOwnerOrCreator } from '../../shared/identity-match.js';
import {
  down as migrate096Down,
  up as migrate096Up,
} from '../../server/db/migrations/096_presentation_list_keyset.js';

const OWNERSHIPS = ['collection', 'owned', 'shared', 'all'];
const VIEW_ONLY = [undefined, true, false];
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
// Owns a deck stamped with the address it had before it changed.
const RENAMED = { ...person('renamed'), email: 'renamed-now@example.com' };
const RENAMED_BEFORE = 'renamed-before@example.com';

pgDescribe(
  'deck list in SQL on the list-page contract (real PostgreSQL)',
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
          [OWNER, MAKER, COLLAB, OUTSIDER, RENAMED].map((p) => ({
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
      actorUserId: actor.id ?? null,
      actorEmail: actor.email ?? null,
    });

    /** Insert one deck row and return its id. */
    async function insertDeck({
      organizationId = orgA,
      visibility = 'private',
      owner = null,
      ownerEmail = owner?.email ?? null,
      maker = owner,
      makerEmail = maker?.email ?? null,
      viewOnly = false,
      modifiedAt = SAME_MOMENT,
      trashed = false,
      title = 'Deck',
    } = {}) {
      const id = crypto.randomUUID();
      await db
        .insertInto('presentations')
        .values({
          id,
          organization_id: organizationId,
          title,
          visibility,
          owner_user_id: owner?.id ?? null,
          owner_email: ownerEmail,
          created_by_user_id: maker?.id ?? null,
          created_by: makerEmail,
          is_view_only: viewOnly,
          modified_at: modifiedAt,
          trashed_at: trashed ? modifiedAt : null,
        })
        .execute();
      return id;
    }

    async function invite(
      presentationId,
      who,
      { revoked = false, organizationId = orgA } = {},
    ) {
      await db
        .insertInto('presentation_collaborators')
        .values({
          presentation_id: presentationId,
          organization_id: organizationId,
          user_email: who.email,
          user_id: who.id ?? null,
          permission: 'edit',
          invited_by: OWNER.email,
          revoked_at: revoked ? '2026-10-02 00:00:00+00' : null,
        })
        .execute();
    }

    /**
     * The parity fixture: 2 visibilities × 3 owners × 3 makers × 3 collaborator
     * states = 54 decks in org A, view-only on every other one, all within a few
     * microseconds of each other (so the tiebreaker and precision matter), plus
     * the special rows.
     */
    async function seedMatrix() {
      const owners = [OWNER, OUTSIDER, null];
      let n = 0;
      for (const visibility of ['private', 'organization']) {
        for (const owner of owners) {
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
                viewOnly: n % 2 === 1,
                modifiedAt:
                  n % 3 === 0
                    ? SAME_MOMENT
                    : `2026-10-01 12:00:00.1234${String(60 + (n % 40)).padStart(2, '0')}+00`,
              });
              if (collab !== 'none') {
                await invite(id, COLLAB, { revoked: collab === 'revoked' });
              }
              n++;
            }
          }
        }
      }
      // Owned by the renamed user under the address it had before.
      await insertDeck({
        owner: RENAMED,
        ownerEmail: RENAMED_BEFORE,
        makerEmail: RENAMED_BEFORE,
      });
      // In the trash: on no list.
      const trashed = await insertDeck({
        owner: OWNER,
        visibility: 'organization',
        trashed: true,
      });
      await invite(trashed, COLLAB);
      // In org B, shared with COLLAB there: on no org-A list.
      const elsewhere = await insertDeck({
        organizationId: orgB,
        owner: OWNER,
        visibility: 'organization',
      });
      await invite(elsewhere, COLLAB, { organizationId: orgB });
    }

    /** Decks of an org in the contract's order, straight from SQL. */
    async function contractOrder(organizationId) {
      const rows = await sql`
      SELECT id FROM presentations
      WHERE organization_id = ${organizationId} AND trashed_at IS NULL
      ORDER BY modified_at DESC, id DESC
    `.execute(db);
      return rows.rows.map((row) => row.id);
    }

    /**
     * The JavaScript reference: the rows of the organization through the
     * per-deck predicates, exactly as the list decided before B820.
     */
    async function referenceList(actor, ownership, viewOnly) {
      const rows = await listPresentations(scopeOf(orgA, actor));
      const shared = new Set();
      if (actor?.email) {
        const grants = await db
          .selectFrom('presentation_collaborators')
          .select('presentation_id')
          .where('user_email', '=', actor.email)
          .where('organization_id', '=', orgA)
          .where('revoked_at', 'is', null)
          .execute();
        for (const g of grants) shared.add(g.presentation_id);
      }
      const inCollection = (pres) => belongsInCollection({ user: actor, pres });
      const inOwned = (pres) =>
        isUnrestricted(actor) || isOwnerOrCreator(actor, pres);
      const inShared = (pres) => shared.has(pres.id);
      const listed = {
        collection: inCollection,
        owned: inOwned,
        shared: inShared,
        all: (pres) => inCollection(pres) || inShared(pres),
      }[ownership];
      const ids = new Set(
        rows
          .filter(listed)
          .filter(
            (pres) => viewOnly === undefined || pres.isViewOnly === viewOnly,
          )
          .map((pres) => pres.id),
      );
      return (await contractOrder(orgA)).filter((id) => ids.has(id));
    }

    /** Walk every page of the service list; returns the pages as id lists. */
    async function walk(actor, input, organizationId = orgA) {
      const pages = [];
      let cursor;
      for (let guard = 0; guard < 100; guard++) {
        const page = await listPresentationPage(
          scopeOf(organizationId, actor),
          { actor },
          cursor ? { ...input, cursor } : input,
        );
        pages.push(page.presentations.map((p) => p.id));
        cursor = page.nextCursor;
        if (cursor === null) return pages;
      }
      throw new Error('the list never ended');
    }

    // The actors, each with the identity the reference decides on. An MCP
    // session carries only an address; the service resolves it to `users.id`
    // the way the by-id deciders do, so its reference is the resolved actor.
    const ACTORS = [
      ['owner', OWNER, OWNER],
      ['maker', MAKER, MAKER],
      ['collaborator', COLLAB, COLLAB],
      ['outsider', OUTSIDER, OUTSIDER],
      ['renamed owner (by id)', RENAMED, RENAMED],
      [
        'renamed owner (address only, current)',
        { email: RENAMED.email },
        { id: RENAMED.id, email: RENAMED.email },
      ],
      [
        'renamed owner (address only, old)',
        { email: RENAMED_BEFORE },
        { id: null, email: RENAMED_BEFORE },
      ],
      ['collaborator (address only)', { email: COLLAB.email }, COLLAB],
      [
        'auth-off operator',
        { email: null, unrestricted: true },
        { email: null, unrestricted: true },
      ],
      ['no identity', {}, {}],
      ['no actor', undefined, undefined],
    ];

    it('parity: the SQL list equals rows.filter(belongsInCollection) for every actor, ownership and viewOnly', async () => {
      await seedMatrix();
      let compared = 0;
      for (const [label, actor, reference] of ACTORS) {
        for (const ownership of OWNERSHIPS) {
          for (const viewOnly of VIEW_ONLY) {
            const expected = await referenceList(
              reference,
              ownership,
              viewOnly,
            );
            const what = `${label} / ${ownership} / viewOnly=${viewOnly}`;

            const pages = await walk(actor, { ownership, viewOnly, limit: 7 });
            for (const page of pages.slice(0, -1)) {
              assert.equal(page.length, 7, `${what}: a full page`);
            }
            assert.deepEqual(pages.flat(), expected, `${what}: paged`);

            const { presentations } = await listPresentationsForActor(
              scopeOf(orgA, actor),
              { actor },
              { ownership, viewOnly },
            );
            assert.deepEqual(
              presentations.map((p) => p.id),
              expected,
              `${what}: unpaged`,
            );
            compared++;
          }
        }
      }
      assert.equal(
        compared,
        ACTORS.length * OWNERSHIPS.length * VIEW_ONLY.length,
      );
    });

    it('parity edge cases: a changed address, a NULL maker id, the trash and another organization', async () => {
      await seedMatrix();
      const ids = async (actor, ownership) =>
        (
          await listPresentationsForActor(
            scopeOf(orgA, actor),
            { actor },
            { ownership },
          )
        ).presentations;

      // The renamed owner keeps its deck: the id is compared, not the address.
      const renamed = await ids(RENAMED, 'owned');
      assert.equal(renamed.length, 1);
      assert.equal(renamed[0].ownerEmail, RENAMED_BEFORE);
      assert.deepEqual(await ids({ email: RENAMED_BEFORE }, 'owned'), []);

      // A NULL maker id names nobody, whatever address sits beside it.
      const madeByMaker = await ids(MAKER, 'owned');
      // MAKER is the stored maker of 2 visibilities × 3 owners × 3
      // collaborator states; the 18 rows with MAKER's address beside a NULL
      // maker id are not MAKER's.
      assert.equal(madeByMaker.length, 18);
      for (const pres of madeByMaker)
        assert.equal(pres.createdBy?.id, MAKER.id);

      // Trashed and org-B decks are on no org-A list, not even the operator's.
      const everything = await ids({ unrestricted: true }, 'all');
      assert.equal(everything.length, 54 + 1);
      const shared = await ids(COLLAB, 'shared');
      assert.equal(shared.length, 18, 'active rows only, in this organization');
      for (const pres of shared) assert.equal(pres.permission, 'edit');
    });

    it('1+2+6: every deck once, in (modified_at desc, id desc), full pages until the end', async () => {
      const ids = [];
      for (let i = 0; i < 10; i++) {
        ids.push(await insertDeck({ owner: OWNER, modifiedAt: SAME_MOMENT }));
      }
      for (let i = 1; i <= 5; i++) {
        ids.push(
          await insertDeck({
            owner: OWNER,
            modifiedAt: `2026-10-01 12:00:01.00000${i}+00`,
          }),
        );
      }
      for (let i = 0; i < 8; i++) {
        ids.push(
          await insertDeck({
            owner: OWNER,
            modifiedAt: `2026-09-${10 + i} 08:00:00+00`,
          }),
        );
      }

      const pages = await walk(OWNER, { ownership: 'owned', limit: 5 });
      assert.deepEqual(
        pages.map((p) => p.length),
        [5, 5, 5, 5, 3],
      );
      const seen = pages.flat();
      assert.equal(new Set(seen).size, seen.length, 'no deck twice');
      assert.deepEqual([...seen].sort(), [...ids].sort(), 'no deck skipped');
      assert.deepEqual(seen, await contractOrder(orgA));
    });

    it('2: the cursor keeps microseconds (decks inside one millisecond)', async () => {
      const ids = [];
      for (let i = 1; i <= 6; i++) {
        ids.push(
          await insertDeck({
            owner: OWNER,
            modifiedAt: `2026-10-01 12:00:01.00000${i}+00`,
          }),
        );
      }
      const pages = await walk(OWNER, { ownership: 'owned', limit: 1 });
      assert.deepEqual(pages.flat(), [...ids].reverse());
    });

    it('3: a deck changed at the top between pages does not move page 2', async () => {
      const ids = [];
      for (let i = 0; i < 12; i++) {
        ids.push(
          await insertDeck({
            owner: OWNER,
            modifiedAt: `2026-09-${10 + i} 08:00:00+00`,
          }),
        );
      }
      const scope = scopeOf(orgA, OWNER);
      const first = await listPresentationPage(
        scope,
        { actor: OWNER },
        { limit: 5 },
      );
      const input = { limit: 5, cursor: first.nextCursor };
      const before = await listPresentationPage(scope, { actor: OWNER }, input);

      await insertDeck({
        owner: OWNER,
        modifiedAt: '2026-10-22 09:00:00.000001+00',
      });
      // And the oldest deck of page 3 is edited: it moves to the top.
      await db
        .updateTable('presentations')
        .set({ modified_at: '2026-10-22 09:00:00.000002+00' })
        .where('id', '=', ids[0])
        .execute();
      const afterChange = await listPresentationPage(
        scope,
        { actor: OWNER },
        input,
      );

      assert.deepEqual(
        afterChange.presentations.map((p) => p.id),
        before.presentations.map((p) => p.id),
      );
      assert.equal(afterChange.nextCursor, before.nextCursor);
    });

    it('4: a cursor from org A used in org B only shows B decks', async () => {
      const idsA = [];
      for (let i = 0; i < 8; i++) {
        idsA.push(
          await insertDeck({
            visibility: 'organization',
            owner: OWNER,
            modifiedAt: `2026-09-${10 + i} 08:00:00+00`,
          }),
        );
      }
      const idsB = [];
      for (const modifiedAt of [
        '2026-09-20 00:00:00+00',
        '2026-09-12 00:00:00+00',
        '2026-08-01 00:00:00+00',
      ]) {
        idsB.push(
          await insertDeck({
            organizationId: orgB,
            visibility: 'organization',
            owner: OWNER,
            modifiedAt,
          }),
        );
      }

      const first = await listPresentationPage(
        scopeOf(orgA, OWNER),
        { actor: OWNER },
        { limit: 3 },
      );
      assert.ok(first.nextCursor);
      const inB = await listPresentationPage(
        scopeOf(orgB, OWNER),
        { actor: OWNER },
        { limit: 100, cursor: first.nextCursor },
      );
      const shown = inB.presentations.map((p) => p.id);
      assert.ok(shown.length > 0, 'the position still applies in B');
      for (const id of shown) {
        assert.ok(idsB.includes(id), 'only B decks');
        assert.ok(!idsA.includes(id), 'never an A deck');
      }
      assert.deepEqual(
        (await walk(OWNER, { limit: 2 }, orgB)).flat(),
        await contractOrder(orgB),
      );
    });

    /** GET /api/v1/presentations through the real route. */
    async function v1(query, actor = OWNER) {
      const res = createMockRes();
      await handleV1Presentations({
        req: {
          method: 'GET',
          headers: { host: 'deck.example' },
          socket: { remoteAddress: '203.0.113.9' },
        },
        res,
        url: new URL(`http://deck.example/api/v1/presentations${query}`),
        repoRoot: process.cwd(),
        storageScope: scopeOf(orgA, actor),
        apiKey: {
          id: 'key-1',
          tier: 'free',
          ownerEmail: actor.email,
          permissions: ['read'],
          organizationId: orgA,
        },
        authedUser: actor,
      });
      return { status: res.statusCode, body: res.json() };
    }

    it('5+6: the v1 route pages full on the contract and refuses offset, a wild limit and a foreign cursor', async () => {
      await seedMatrix();
      const pages = [];
      let cursor = null;
      do {
        const { status, body } = await v1(
          `?viewOnly=true&limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        assert.equal(status, 200, JSON.stringify(body));
        assert.equal('pagination' in body, false);
        pages.push(body.presentations.map((p) => p.id));
        cursor = body.nextCursor;
      } while (cursor);
      for (const page of pages.slice(0, -1)) assert.equal(page.length, 4);
      assert.deepEqual(
        pages.flat(),
        await referenceList(OWNER, 'collection', true),
      );

      const first = await v1('?viewOnly=true&limit=4');
      for (const [query, field] of [
        ['?offset=4', 'offset'],
        ['?limit=0', 'limit'],
        ['?limit=500', 'limit'],
        [
          `?viewOnly=false&cursor=${encodeURIComponent(first.body.nextCursor)}`,
          'cursor',
        ],
        [`?cursor=${encodeURIComponent(first.body.nextCursor)}`, 'cursor'],
      ]) {
        const { status, body } = await v1(query);
        assert.equal(status, 400, query);
        assert.equal(body.error, 'invalid', query);
        assert.equal(body.details.field, field, query);
        if (field === 'offset') assert.equal(body.details.use, 'cursor');
      }
    });

    /**
     * Tag decks of org A by position in the contract order: `Alpha` on every
     * third, `beta` on every fifth. Org B holds a tag `alpha` too, attached
     * to org-A decks: a tag of another organization names nothing here.
     * @returns {Promise<Map<string, Set<string>>>} deck id → lower tag names
     */
    async function seedTags() {
      const order = await contractOrder(orgA);
      const tag = async (organizationId, name) => {
        const id = crypto.randomUUID();
        await db
          .insertInto('tags')
          .values({ id, organization_id: organizationId, name })
          .execute();
        return id;
      };
      const alpha = await tag(orgA, 'Alpha');
      const beta = await tag(orgA, 'beta');
      const foreign = await tag(orgB, 'alpha');
      const tagged = new Map();
      const attach = async (deckId, tagId, name) => {
        await db
          .insertInto('presentation_tags')
          .values({ presentation_id: deckId, tag_id: tagId })
          .execute();
        if (name) {
          if (!tagged.has(deckId)) tagged.set(deckId, new Set());
          tagged.get(deckId).add(name);
        }
      };
      for (const [i, id] of order.entries()) {
        if (i % 3 === 0) await attach(id, alpha, 'alpha');
        if (i % 5 === 0) await attach(id, beta, 'beta');
        if (i % 4 === 1) await attach(id, foreign, null);
      }
      return tagged;
    }

    it('B821 filters: visibility and tags are in the query, full pages, parity with the reference', async () => {
      await seedMatrix();
      const tagged = await seedTags();
      const visibilityOf = new Map(
        (
          await db
            .selectFrom('presentations')
            .select(['id', 'visibility'])
            .where('organization_id', '=', orgA)
            .execute()
        ).map((row) => [row.id, row.visibility]),
      );
      const actors = [
        ['owner', OWNER],
        ['collaborator', COLLAB],
        ['auth-off operator', { email: null, unrestricted: true }],
      ];
      const tagFilters = [undefined, ['ALPHA'], ['alpha', 'Beta']];
      let compared = 0;
      for (const [label, actor] of actors) {
        for (const ownership of ['collection', 'owned', 'shared', 'all']) {
          for (const visibility of [undefined, 'private', 'organization']) {
            for (const tags of tagFilters) {
              const wanted = tags?.map((t) => t.toLowerCase());
              const expected = (
                await referenceList(actor, ownership, undefined)
              ).filter((id) => {
                const row = visibilityOf.get(id);
                if (visibility && row !== visibility) return false;
                if (!wanted) return true;
                return wanted.some((t) => tagged.get(id)?.has(t));
              });
              const what = `${label} / ${ownership} / ${visibility} / ${tags}`;
              const pages = await walk(actor, {
                ownership,
                visibility,
                tags,
                limit: 4,
              });
              for (const page of pages.slice(0, -1)) {
                assert.equal(page.length, 4, `${what}: a full page`);
              }
              assert.deepEqual(pages.flat(), expected, what);
              compared++;
            }
          }
        }
      }
      assert.equal(compared, 3 * 4 * 3 * 3);
    });

    /** A GET on an internal deck-list route, as `actor`, in `organizationId`. */
    async function internalList(path, actor, organizationId = orgA) {
      const res = createMockRes();
      const handler = path.startsWith('/api/presentations/shared-with-me')
        ? handleCollaborators
        : handleInternalPresentations;
      await handler({
        req: {
          method: 'GET',
          headers: { host: 'deck.example' },
          socket: { remoteAddress: '203.0.113.9' },
        },
        res,
        url: new URL(`http://deck.example${path}`),
        repoRoot: process.cwd(),
        storageScope: scopeOf(organizationId, actor),
        authedUser: actor,
      });
      return { status: res.statusCode, body: res.json() };
    }

    /** Walk an internal route to the end; returns the pages as id lists. */
    async function walkRoute(path, actor, organizationId = orgA) {
      const pages = [];
      let cursor = null;
      const join = path.includes('?') ? '&' : '?';
      for (let guard = 0; guard < 100; guard++) {
        const { status, body } = await internalList(
          cursor ? `${path}${join}cursor=${encodeURIComponent(cursor)}` : path,
          actor,
          organizationId,
        );
        assert.equal(status, 200, JSON.stringify(body));
        pages.push(body.presentations.map((p) => p.id));
        cursor = body.nextCursor;
        if (cursor === null) return pages;
      }
      throw new Error('the list never ended');
    }

    it('B821 routes 1+2+5+6: Home and shared-with-me page on the contract and refuse what it refuses', async () => {
      await seedMatrix();
      const cases = [
        ['/api/presentations?limit=4', OWNER, 'collection'],
        ['/api/presentations?ownership=all&limit=4', COLLAB, 'all'],
        ['/api/presentations?ownership=owned&limit=4', MAKER, 'owned'],
        ['/api/presentations/shared-with-me?limit=4', COLLAB, 'shared'],
      ];
      for (const [path, actor, ownership] of cases) {
        const pages = await walkRoute(path, actor);
        const expected = await referenceList(actor, ownership, undefined);
        assert.ok(pages.length > 2, `${path}: more than two pages`);
        for (const page of pages.slice(0, -1)) {
          assert.equal(page.length, 4, `${path}: a full page`);
        }
        const seen = pages.flat();
        assert.equal(new Set(seen).size, seen.length, `${path}: no deck twice`);
        assert.deepEqual(seen, expected, `${path}: every deck, in order`);
      }

      const home = await internalList('/api/presentations?limit=4', OWNER);
      const shared = await internalList(
        '/api/presentations/shared-with-me?limit=4',
        COLLAB,
      );
      const homeCursor = encodeURIComponent(home.body.nextCursor);
      const sharedCursor = encodeURIComponent(shared.body.nextCursor);
      for (const [path, actor, field] of [
        ['/api/presentations?offset=4', OWNER, 'offset'],
        ['/api/presentations?limit=0', OWNER, 'limit'],
        ['/api/presentations?limit=101', OWNER, 'limit'],
        ['/api/presentations?limit=abc', OWNER, 'limit'],
        ['/api/presentations?cursor=broken', OWNER, 'cursor'],
        [
          `/api/presentations?ownership=all&cursor=${homeCursor}`,
          OWNER,
          'cursor',
        ],
        [
          `/api/presentations?visibility=organization&cursor=${homeCursor}`,
          OWNER,
          'cursor',
        ],
        [`/api/presentations?cursor=${sharedCursor}`, OWNER, 'cursor'],
        ['/api/presentations?visibility=public', OWNER, 'visibility'],
        ['/api/presentations?ownership=mine', OWNER, 'ownership'],
        ['/api/presentations/shared-with-me?offset=4', COLLAB, 'offset'],
        ['/api/presentations/shared-with-me?limit=500', COLLAB, 'limit'],
        [
          `/api/presentations/shared-with-me?cursor=${homeCursor}`,
          COLLAB,
          'cursor',
        ],
      ]) {
        const { status, body } = await internalList(path, actor);
        assert.equal(status, 400, path);
        assert.equal(body.error, 'invalid', path);
        assert.equal(body.details.field, field, path);
      }
    });

    it('B821 routes 3+4: Home keeps page 2 when a deck moves to the top; an org-A cursor shows only B decks', async () => {
      const ids = [];
      for (let i = 0; i < 9; i++) {
        ids.push(
          await insertDeck({
            owner: OWNER,
            visibility: 'organization',
            modifiedAt: `2026-09-${10 + i} 08:00:00+00`,
          }),
        );
      }
      const first = await internalList('/api/presentations?limit=3', OWNER);
      const page2 = `/api/presentations?limit=3&cursor=${encodeURIComponent(first.body.nextCursor)}`;
      const before = await internalList(page2, OWNER);
      await db
        .updateTable('presentations')
        .set({ modified_at: '2026-10-22 09:00:00.000001+00' })
        .where('id', '=', ids[0])
        .execute();
      await insertDeck({
        owner: OWNER,
        modifiedAt: '2026-10-22 09:00:00.000002+00',
      });
      const after = await internalList(page2, OWNER);
      assert.deepEqual(after.body, before.body);

      const idsB = [];
      for (const modifiedAt of [
        '2026-09-30 00:00:00+00',
        '2026-09-11 00:00:00+00',
        '2026-08-01 00:00:00+00',
      ]) {
        idsB.push(
          await insertDeck({
            organizationId: orgB,
            visibility: 'organization',
            owner: OWNER,
            modifiedAt,
          }),
        );
      }
      const inB = await internalList(page2, OWNER, orgB);
      assert.equal(inB.status, 200);
      assert.ok(inB.body.presentations.length > 0);
      for (const p of inB.body.presentations) {
        assert.ok(idsB.includes(p.id), 'only B decks');
      }
    });

    it('migration 096 backfills a NULL modified_at and makes the column NOT NULL', async () => {
      const runInTx = (fn) => db.transaction().execute((trx) => fn(trx));
      await runInTx(migrate096Down);
      try {
        const createdAt = '2026-09-01 10:00:00.5+00';
        const id = crypto.randomUUID();
        await sql`
        INSERT INTO presentations (id, organization_id, title, created_at, modified_at)
        VALUES (${id}, ${orgA}, 'old', ${createdAt}::timestamptz, NULL)
      `.execute(db);

        await runInTx(migrate096Up);

        const row = await sql`
        SELECT modified_at = ${createdAt}::timestamptz AS backfilled
        FROM presentations WHERE id = ${id}
      `.execute(db);
        assert.equal(
          row.rows[0].backfilled,
          true,
          'created_at is the backfill',
        );
        await assert.rejects(
          sql`UPDATE presentations SET modified_at = NULL WHERE id = ${id}`.execute(
            db,
          ),
          /null value|not-null/i,
          'NOT NULL holds',
        );
        // Idempotent: a second run finds nothing to do.
        await runInTx(migrate096Up);
      } finally {
        // Leave the schema migrated whatever happened above.
        await runInTx(migrate096Up);
      }
    });

    it('the page query walks idx_presentations_list_keyset without a sort (10 000 decks)', async () => {
      await sql`
      INSERT INTO presentations
        (id, organization_id, title, visibility, owner_user_id, owner_email, modified_at)
      SELECT gen_random_uuid(), ${orgA}, 'bulk',
        CASE WHEN g % 10 = 0 THEN 'organization' ELSE 'private' END,
        CASE WHEN g % 7 = 0 THEN ${OWNER.id}::uuid ELSE ${OUTSIDER.id}::uuid END,
        'bulk@example.com',
        timestamptz '2026-01-01' + (g * interval '1 minute')
      FROM generate_series(1, 10000) AS g
    `.execute(db);
      await sql`ANALYZE presentations`.execute(db);

      const plans = {};
      for (const ownership of ['collection', 'all']) {
        const reader = { userId: OWNER.id, email: OWNER.email };
        const page = keysetPage(
          __deckList.deckListQuery(db, orgA, {
            reader,
            terms: __deckList.deckListTerms(reader, ownership),
          }),
          {
            column: 'modified_at',
            after: { value: '2026-01-04 00:00:00+00', id: crypto.randomUUID() },
            limit: 50,
          },
        ).compile();
        const plan = await db.executeQuery(
          CompiledQuery.raw(`EXPLAIN ${page.sql}`, [...page.parameters]),
        );
        plans[ownership] = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
      }
      for (const [ownership, text] of Object.entries(plans)) {
        assert.match(
          text,
          /idx_presentations_list_keyset/,
          `${ownership}\n${text}`,
        );
        assert.doesNotMatch(text, /\bSort\b/, `${ownership}\n${text}`);
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
