/**
 * The slide-library tags routes follow the save contract (D170, B340), against
 * real PostgreSQL.
 *
 * Before B340 `GET|PUT /api/slide-library/<shelf>/<id>/tags` read and wrote on
 * the id alone: a colleague could read and replace the tags of someone else's
 * personal item, reach an item through the wrong shelf's path, and retag a
 * shared item they may not change. The tags reader and writer now select the
 * item through `whereItem` (shelf, and on the personal shelf the owner), and on
 * the organization shelf writing passes the one creator-or-admin predicate.
 *
 * This drives the real route (`handleSlideLibrary`), so the predicate under
 * test is the one the route passes, not a stand-in guard. What it pins:
 *  - someone else's personal item is a 404 on GET and PUT, and its tags stay;
 *  - an item addressed through the other shelf's path is a 404 on GET and PUT;
 *  - a member who is neither creator nor admin gets a 403 on an organization
 *    PUT, and the tags stay; every member may read them;
 *  - the owner, the creator and an admin get through;
 *  - a tags write does not raise the item's revision.
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
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createOrganizationLibraryItem,
  createPersonalLibraryItem,
  setTagsForSlideLibraryItem,
} from '../../server/storage/slide-library.js';
import { handleSlideLibrary } from '../../server/routes/api/slide-library.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

const storageScope = testScope();
const ORG = getDefaultOrganizationId();

const ALICE = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'alice@example.com',
};
const BOB = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'bob@example.com',
};
const ADMIN = {
  id: '33333333-3333-3333-3333-333333333333',
  email: 'admin@example.com',
  isAdmin: true,
};

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

async function call(user, method, path, body) {
  const req = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
  req.headers = {};
  const res = mockRes();
  await handleSlideLibrary({
    repoRoot: '/tmp',
    storageScope,
    authedUser: user,
    req,
    res,
    url: { pathname: path, searchParams: new URLSearchParams() },
  });
  return res;
}

const getTags = (user, shelf, id) =>
  call(user, 'GET', `/api/slide-library/${shelf}/${id}/tags`);
const putTags = (user, shelf, id, tags) =>
  call(user, 'PUT', `/api/slide-library/${shelf}/${id}/tags`, { tags });

async function storedTagNames(db, id) {
  const rows = await db
    .selectFrom('tags')
    .innerJoin('slide_library_tags', 'tags.id', 'slide_library_tags.tag_id')
    .select('tags.name')
    .where('slide_library_tags.slide_library_id', '=', id)
    .orderBy('tags.name', 'asc')
    .execute();
  return rows.map((r) => r.name);
}

pgDescribe(
  'slide-library tags routes follow the save contract (real PostgreSQL)',
  () => {
    /** @type {import('kysely').Kysely<any>} */
    let db;
    let alicePersonal;
    let orgItem;

    before(async () => {
      db = await openTestDb();
      await installFacadeStorage();
    });

    after(async () => {
      uninstallFacadeStorage();
      await closeTestDb(db);
    });

    beforeEach(async () => {
      await truncate(db, 'slide_library', 'tags', 'users', 'organizations');
      await seedDefaultOrganization(db);
      await db
        .insertInto('users')
        .values(
          [ALICE, BOB, ADMIN].map((u) => ({
            id: u.id,
            organization_id: ORG,
            email: u.email,
            name: u.email,
            role: u.isAdmin ? 'admin' : 'user',
          })),
        )
        .execute();

      alicePersonal = (
        await createPersonalLibraryItem(
          storageScope,
          ALICE.email,
          { name: 'Mine', slideType: 'content-slide', content: {} },
          { actorEmail: ALICE.email },
        )
      ).item;
      orgItem = (
        await createOrganizationLibraryItem(
          storageScope,
          { name: 'Team', slideType: 'content-slide', content: {} },
          { actorEmail: ALICE.email },
        )
      ).item;
      for (const item of [alicePersonal, orgItem]) {
        const r = await setTagsForSlideLibraryItem(
          storageScope,
          { id: item.id, shelf: item.shelf },
          ['original'],
          { actorEmail: ALICE.email, allowEdit: () => true },
        );
        assert.equal(r.ok, true, 'fixture tags are written');
      }
    });

    // --- someone else's personal item ------------------------------------------

    it("answers 404 when Bob reads the tags of Alice's personal item", async () => {
      const res = await getTags(BOB, 'personal', alicePersonal.id);
      assert.equal(res.statusCode, 404);
      assert.equal(res.payload.error, 'not_found');
    });

    it("answers 404 when Bob replaces the tags of Alice's personal item, and they stay", async () => {
      const res = await putTags(BOB, 'personal', alicePersonal.id, [
        'hijacked',
      ]);
      assert.equal(res.statusCode, 404);
      assert.deepEqual(await storedTagNames(db, alicePersonal.id), [
        'original',
      ]);
    });

    it('gives an admin no way into a personal item that is not theirs', async () => {
      const res = await putTags(ADMIN, 'personal', alicePersonal.id, ['x']);
      assert.equal(res.statusCode, 404);
      assert.deepEqual(await storedTagNames(db, alicePersonal.id), [
        'original',
      ]);
    });

    // --- the wrong shelf ------------------------------------------------------

    it('answers 404 for an organization item addressed through the personal path', async () => {
      assert.equal(
        (await getTags(ALICE, 'personal', orgItem.id)).statusCode,
        404,
      );
      const res = await putTags(ALICE, 'personal', orgItem.id, ['wrong-shelf']);
      assert.equal(res.statusCode, 404);
      assert.deepEqual(await storedTagNames(db, orgItem.id), ['original']);
    });

    it('answers 404 for a personal item addressed through the organization path', async () => {
      assert.equal(
        (await getTags(ALICE, 'organization', alicePersonal.id)).statusCode,
        404,
      );
      const res = await putTags(ADMIN, 'organization', alicePersonal.id, ['x']);
      assert.equal(res.statusCode, 404);
      assert.deepEqual(await storedTagNames(db, alicePersonal.id), [
        'original',
      ]);
    });

    // --- the organization shelf -----------------------------------------------

    it('lets every member read the tags of a shared item', async () => {
      const res = await getTags(BOB, 'organization', orgItem.id);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(
        res.payload.map((t) => t.name),
        ['original'],
      );
    });

    it('answers 403 when a member who is neither creator nor admin retags a shared item, and they stay', async () => {
      const res = await putTags(BOB, 'organization', orgItem.id, ['hijacked']);
      assert.equal(res.statusCode, 403);
      assert.equal(res.payload.error, 'forbidden');
      assert.deepEqual(await storedTagNames(db, orgItem.id), ['original']);
    });

    it('lets the creator retag a shared item', async () => {
      const res = await putTags(ALICE, 'organization', orgItem.id, ['b', 'a']);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(await storedTagNames(db, orgItem.id), ['a', 'b']);
    });

    it('lets an admin retag a shared item', async () => {
      const res = await putTags(ADMIN, 'organization', orgItem.id, [
        'by-admin',
      ]);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(await storedTagNames(db, orgItem.id), ['by-admin']);
    });

    // --- the owner --------------------------------------------------------------

    it('lets the owner read and replace the tags of their personal item', async () => {
      const put = await putTags(ALICE, 'personal', alicePersonal.id, ['mine']);
      assert.equal(put.statusCode, 200);
      const got = await getTags(ALICE, 'personal', alicePersonal.id);
      assert.equal(got.statusCode, 200);
      assert.deepEqual(
        got.payload.map((t) => t.name),
        ['mine'],
      );
    });

    it('does not raise the revision on a tags write (tags take no If-Match)', async () => {
      await putTags(ALICE, 'organization', orgItem.id, ['again']);
      const row = await db
        .selectFrom('slide_library')
        .select('revision')
        .where('id', '=', orgItem.id)
        .executeTakeFirstOrThrow();
      assert.equal(row.revision, orgItem.revision);
    });
  },
);
