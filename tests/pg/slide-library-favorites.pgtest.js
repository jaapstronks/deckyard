/**
 * A slide-library favorite is stored per user (B334, D170), against real
 * PostgreSQL.
 *
 * Before B334 the client patched `{ favorite }` and read `isFavorite` on the
 * organization shelf and `favorite` on the personal one, while storage kept a
 * `favorites` address list it never wrote: a favorite-only PATCH wrote nothing,
 * and the star fell back on reload. The item now carries one flag, `favorite`,
 * the caller's own, derived from `favorites`; the addresses never leave storage.
 *
 * This drives the real route (`handleSlideLibrary`). What it pins:
 *  - a star survives a reload on both shelves, and clearing it does too;
 *  - on the organization shelf every member may star, and each sees only
 *    their own star;
 *  - the item is selected like every mutation: someone else's personal item
 *    and the wrong shelf's path are a 404 and write nothing;
 *  - a favorite takes no If-Match, raises no revision and stamps no update;
 *  - the list never carries the `favorites` addresses.
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

const star = (user, shelf, id, favorite) =>
  call(user, 'PATCH', `/api/slide-library/${shelf}/${id}`, { favorite });
const list = (user, shelf) => call(user, 'GET', `/api/slide-library/${shelf}`);

async function flagIn(user, shelf, id) {
  const res = await list(user, shelf);
  assert.equal(res.statusCode, 200);
  const item = res.payload.items.find((it) => it.id === id);
  assert.ok(item, `item ${id} is listed for ${user.email}`);
  return item.favorite;
}

async function storedFavorites(db, id) {
  const row = await db
    .selectFrom('slide_library')
    .select(['favorites', 'revision', 'updated_at', 'updated_by'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return row;
}

pgDescribe(
  'slide-library favorites are stored per user (real PostgreSQL)',
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
      await truncate(db, 'slide_library', 'users', 'organizations');
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
    });

    // --- the star survives a reload ---------------------------------------------

    it('keeps a star on a personal item across a reload, and keeps clearing it', async () => {
      const res = await star(ALICE, 'personal', alicePersonal.id, true);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.favorite, true);
      assert.equal(await flagIn(ALICE, 'personal', alicePersonal.id), true);

      const off = await star(ALICE, 'personal', alicePersonal.id, false);
      assert.equal(off.statusCode, 200);
      assert.equal(off.payload.favorite, false);
      assert.equal(await flagIn(ALICE, 'personal', alicePersonal.id), false);
    });

    it('keeps a star on an organization item across a reload', async () => {
      const res = await star(ALICE, 'organization', orgItem.id, true);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.favorite, true);
      assert.equal(await flagIn(ALICE, 'organization', orgItem.id), true);
    });

    it('stores a repeated star once', async () => {
      await star(ALICE, 'organization', orgItem.id, true);
      await star(ALICE, 'organization', orgItem.id, true);
      const row = await storedFavorites(db, orgItem.id);
      assert.deepEqual(row.favorites, [ALICE.email]);
    });

    // --- per user, open to every member ----------------------------------------

    it('lets a member who may not edit a shared item star it, for themselves only', async () => {
      const res = await star(BOB, 'organization', orgItem.id, true);
      assert.equal(res.statusCode, 200);
      assert.equal(res.payload.favorite, true);
      assert.equal(await flagIn(BOB, 'organization', orgItem.id), true);
      assert.equal(await flagIn(ALICE, 'organization', orgItem.id), false);
      assert.equal(await flagIn(ADMIN, 'organization', orgItem.id), false);
    });

    it("clears only the caller's own star", async () => {
      await star(ALICE, 'organization', orgItem.id, true);
      await star(BOB, 'organization', orgItem.id, true);
      await star(BOB, 'organization', orgItem.id, false);
      assert.equal(await flagIn(ALICE, 'organization', orgItem.id), true);
      assert.equal(await flagIn(BOB, 'organization', orgItem.id), false);
    });

    it('never lists the favorites addresses', async () => {
      await star(BOB, 'organization', orgItem.id, true);
      const res = await list(ALICE, 'organization');
      const item = res.payload.items.find((it) => it.id === orgItem.id);
      assert.equal('favorites' in item, false);
      assert.equal(JSON.stringify(res.payload).includes(BOB.email), false);
    });

    // --- selected like every mutation -------------------------------------------

    it("answers 404 when Bob stars Alice's personal item, and writes nothing", async () => {
      const res = await star(BOB, 'personal', alicePersonal.id, true);
      assert.equal(res.statusCode, 404);
      assert.deepEqual(
        (await storedFavorites(db, alicePersonal.id)).favorites,
        [],
      );
    });

    it("answers 404 for an item addressed through the other shelf's path", async () => {
      assert.equal(
        (await star(ALICE, 'personal', orgItem.id, true)).statusCode,
        404,
      );
      assert.equal(
        (await star(ALICE, 'organization', alicePersonal.id, true)).statusCode,
        404,
      );
      assert.deepEqual((await storedFavorites(db, orgItem.id)).favorites, []);
      assert.deepEqual(
        (await storedFavorites(db, alicePersonal.id)).favorites,
        [],
      );
    });

    it('refuses a favorite that is not a boolean', async () => {
      const res = await star(ALICE, 'personal', alicePersonal.id, 'yes');
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.details.field, 'favorite');
    });

    // --- not an edit of the item -----------------------------------------------

    it('takes no If-Match, raises no revision and stamps no update', async () => {
      const before = await storedFavorites(db, orgItem.id);
      const res = await star(BOB, 'organization', orgItem.id, true);
      assert.equal(res.statusCode, 200);
      const now = await storedFavorites(db, orgItem.id);
      assert.equal(now.revision, before.revision);
      assert.equal(String(now.updated_at), String(before.updated_at));
      assert.equal(now.updated_by, ALICE.email);
    });
  },
);
