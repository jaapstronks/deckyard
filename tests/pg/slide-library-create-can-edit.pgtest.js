/**
 * A created library item carries the server's `canEdit` verdict (D170, B411).
 *
 * The client reads `canEdit` on every card and fails closed when it is
 * absent. The list and PATCH responses carried it, the two create responses
 * did not, so "Duplicate to my library" put a bare item in the cache and the
 * user's own new card showed "Move to trash" as refused until the next
 * refetch. The verdict comes from the server on every item it returns; the
 * client derives nothing ("personal ⇒ editable" would be a second reader).
 *
 * This drives the real route (`handleSlideLibrary`). What it pins:
 *  - a personal create answers `canEdit: true`;
 *  - an organization create answers the creator-or-admin verdict, and that
 *    verdict equals what the shelf list says for the same user and item.
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

const NEW_ITEM = { name: 'Fresh', slideType: 'content-slide', content: {} };

pgDescribe(
  'slide-library create responses carry canEdit (real PostgreSQL)',
  () => {
    /** @type {import('kysely').Kysely<any>} */
    let db;

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
          [ALICE, BOB].map((u) => ({
            id: u.id,
            organization_id: ORG,
            email: u.email,
            name: u.email,
            role: 'user',
          })),
        )
        .execute();
    });

    it('a personal create answers canEdit: true', async () => {
      const res = await call(
        ALICE,
        'POST',
        '/api/slide-library/personal',
        NEW_ITEM,
      );
      assert.equal(res.statusCode, 201);
      assert.equal(res.payload.canEdit, true);
    });

    it('an organization create answers the verdict the list gives', async () => {
      const res = await call(
        ALICE,
        'POST',
        '/api/slide-library/organization',
        NEW_ITEM,
      );
      assert.equal(res.statusCode, 201);
      assert.equal(res.payload.canEdit, true, 'the creator may edit');

      for (const user of [ALICE, BOB]) {
        const list = await call(user, 'GET', '/api/slide-library/organization');
        const listed = list.payload.items.find((i) => i.id === res.payload.id);
        assert.equal(
          listed.canEdit,
          user === ALICE,
          `${user.email}: the list's verdict`,
        );
      }
    });
  },
);
