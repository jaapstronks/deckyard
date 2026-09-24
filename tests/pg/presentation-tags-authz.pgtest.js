/**
 * The deck tags routes authorize the deck, against real PostgreSQL (B436).
 *
 * Before B436 `GET|PUT /api/presentations/:id/tags` read and replaced tags on
 * the id alone: no `withPresentationAuth` between the route and storage, and
 * `replaceTagLinks` deleted `presentation_tags` by `presentation_id` with no
 * organization in the WHERE. A member of organization B wiped the tags of a
 * deck in organization A with one `PUT`, and within one organization any
 * member could read and retag a private deck they may not open. Found by the
 * tenant-isolation audit in dreamkit-slides.
 *
 * This drives the real route (`handlePresentations`, the dispatcher the deck
 * routes are mounted in), so the authorization under test is the one the
 * route runs. What it pins:
 *  - a deck in another organization is a 404 on GET and PUT, and its tags stay;
 *  - a private deck of a colleague is a 403 on GET and PUT, and its tags stay;
 *  - the owner reads and replaces them;
 *  - a refused tag name through the route is the one `400 invalid` naming the
 *    field (moved here from tests/tag-name-contract.test.js, which cannot
 *    reach it without a deck row any more);
 *  - storage binds the replacement to the organization on its own (defense in
 *    depth): `setTagsForPresentation` and `replaceTagLinks` from another
 *    organization's scope answer `not_found` and delete nothing.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import {
  seedDefaultOrganization,
  seedSlideLibraryItem,
} from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  replaceTagLinks,
  setTagsForPresentation,
} from '../../server/storage/tags.js';
import { handlePresentations } from '../../server/routes/api/presentations/index.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

const ORG_A = getDefaultOrganizationId();
const ORG_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const scopeA = testScope();
const scopeB = { repoRoot: null, organizationId: ORG_B };

const ALICE = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'alice@example.com',
  organizationId: ORG_A,
};
const BOB = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'bob@example.com',
  organizationId: ORG_A,
};
const CAROL = {
  id: '33333333-3333-3333-3333-333333333333',
  email: 'carol@example.com',
  organizationId: ORG_B,
};

const DECK = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function mockRes() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    writeHead(c, headers) {
      this.statusCode = c;
      Object.assign(this.headers, headers);
    },
    end(payload) {
      this.payload = payload ? JSON.parse(payload) : null;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

async function call(user, scope, method, body) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = {};
  const res = mockRes();
  const path = `/api/presentations/${DECK}/tags`;
  await handlePresentations({
    repoRoot: '/tmp',
    storageScope: scope,
    authedUser: user,
    req,
    res,
    url: { pathname: path, searchParams: new URLSearchParams() },
  });
  return res;
}

async function storedTagNames(db) {
  const rows = await db
    .selectFrom('tags')
    .innerJoin('presentation_tags', 'tags.id', 'presentation_tags.tag_id')
    .select('tags.name')
    .where('presentation_tags.presentation_id', '=', DECK)
    .orderBy('tags.name', 'asc')
    .execute();
  return rows.map((r) => r.name);
}

pgDescribe('deck tags routes authorize the deck (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let multiOrgBefore;

  before(async () => {
    multiOrgBefore = process.env.MULTI_ORG_ENABLED;
    process.env.MULTI_ORG_ENABLED = 'true';
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    if (multiOrgBefore === undefined) delete process.env.MULTI_ORG_ENABLED;
    else process.env.MULTI_ORG_ENABLED = multiOrgBefore;
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    // CASCADE clears users, decks, tags and their links under the orgs.
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    await db
      .insertInto('organizations')
      .values({ id: ORG_B, name: 'Other', slug: 'other' })
      .execute();
    await db
      .insertInto('users')
      .values(
        [ALICE, BOB, CAROL].map((u) => ({
          id: u.id,
          organization_id: u.organizationId,
          email: u.email,
          name: u.email,
          role: 'user',
        })),
      )
      .execute();
    await db
      .insertInto('presentations')
      .values({
        id: DECK,
        organization_id: ORG_A,
        title: 'Alice private',
        owner_email: ALICE.email,
        owner_user_id: ALICE.id,
        created_by: ALICE.email,
        visibility: 'private',
      })
      .execute();
    const set = await setTagsForPresentation(scopeA, DECK, ['keep', 'me']);
    assert.equal(set.ok, true);
  });

  it('a deck in another organization is a 404, and its tags stay', async () => {
    const get = await call(CAROL, scopeB, 'GET');
    assert.equal(get.statusCode, 404);

    const put = await call(CAROL, scopeB, 'PUT', { tags: [] });
    assert.equal(put.statusCode, 404);
    assert.deepEqual(await storedTagNames(db), ['keep', 'me']);
  });

  it("a colleague's private deck is a 403, and its tags stay", async () => {
    const get = await call(BOB, scopeA, 'GET');
    assert.equal(get.statusCode, 403);

    const put = await call(BOB, scopeA, 'PUT', { tags: ['bob-was-here'] });
    assert.equal(put.statusCode, 403);
    assert.deepEqual(await storedTagNames(db), ['keep', 'me']);
  });

  it('the owner reads and replaces the tags', async () => {
    const get = await call(ALICE, scopeA, 'GET');
    assert.equal(get.statusCode, 200);
    assert.deepEqual(
      get.payload.map((t) => t.name),
      ['keep', 'me'],
    );

    const put = await call(ALICE, scopeA, 'PUT', { tags: ['fresh'] });
    assert.equal(put.statusCode, 200);
    assert.deepEqual(
      put.payload.map((t) => t.name),
      ['fresh'],
    );
    assert.deepEqual(await storedTagNames(db), ['fresh']);
  });

  it('a refused tag name through the route is a 400 naming the field', async () => {
    const res = await call(ALICE, scopeA, 'PUT', { tags: ['keeper', '   '] });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, 'invalid');
    assert.equal(res.payload.details.field, 'tags');
    assert.equal(res.payload.details.index, 1);
    assert.equal(res.payload.details.reason, 'blank');
    assert.deepEqual(await storedTagNames(db), ['keep', 'me']);
  });

  it("storage refuses another organization's deck on its own", async () => {
    const r = await setTagsForPresentation(scopeB, DECK, ['from-b']);
    assert.deepEqual(r, { ok: false, reason: 'not_found' });
    assert.deepEqual(await storedTagNames(db), ['keep', 'me']);
    const leaked = await db
      .selectFrom('tags')
      .select('name')
      .where('organization_id', '=', ORG_B)
      .execute();
    assert.deepEqual(leaked, [], 'no tag was minted in the other organization');
  });

  it("the one replacement path refuses another organization's library item too", async () => {
    const itemId = await seedSlideLibraryItem(db, { organizationId: ORG_A });
    const ok = await replaceTagLinks({
      linkTable: 'slide_library_tags',
      rowId: itemId,
      orgId: ORG_A,
      tagNames: ['shelf'],
    });
    assert.equal(ok.ok, true);

    const r = await replaceTagLinks({
      linkTable: 'slide_library_tags',
      rowId: itemId,
      orgId: ORG_B,
      tagNames: [],
    });
    assert.deepEqual(r, { ok: false, reason: 'not_found' });
    const links = await db
      .selectFrom('slide_library_tags')
      .select('tag_id')
      .where('slide_library_id', '=', itemId)
      .execute();
    assert.equal(links.length, 1, 'the link survived');
  });
});
