import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { testScope } from './helpers/storage-scope.js';
import { seedRow } from './helpers/theme-seed.js';
import {
  sessionFor,
  userIdFor,
  userRows,
} from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = 'deckyard-test-b568'.padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const ABSENT = '00000000-0000-4000-8000-00000000dead';
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');

let db;

test.before(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER, OTHER),
    themes: [await seedRow('brand')],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

function rowOf(id) {
  return db.__tables.presentations.find((row) => row.id === id);
}

async function deck({ trashed = true } = {}) {
  const pres = await createPresentation(testScope(process.cwd()), {
    title: 'Restore contract',
    ownerEmail: OWNER,
  });
  if (trashed) {
    rowOf(pres.id).trashed_at = new Date().toISOString();
    rowOf(pres.id).trashed_by_user_id = userIdFor(OWNER);
    rowOf(pres.id).trashed_by = OWNER;
  }
  return pres;
}

function response() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

async function request(
  method,
  path,
  actor = sessionFor(OWNER, { isAdmin: false }),
) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = {};
  const res = response();
  await handlePresentations({
    repoRoot: process.cwd(),
    storageScope: testScope(process.cwd()),
    req,
    res,
    url: new URL(`http://test.local/api/presentations/${path}`),
    authedUser: actor,
  });
  return res;
}

test('owner restores a trashed deck and it returns to the live list', async () => {
  const pres = await deck();
  const restored = await request('POST', `${pres.id}/restore`);
  assert.equal(restored.statusCode, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.id, pres.id);
  assert.equal(rowOf(pres.id).trashed_at, null);
  const trash = await request('GET', 'trash');
  assert.equal(trash.statusCode, 200);
  assert.ok(!trash.body.some((item) => item.id === pres.id));
});

test('admin and the original trasher may restore after ownership changes', async () => {
  const adminDeck = await deck();
  const admin = sessionFor(OTHER, { isAdmin: true });
  assert.equal(
    (await request('POST', `${adminDeck.id}/restore`, admin)).statusCode,
    200,
  );

  const trasherDeck = await deck();
  rowOf(trasherDeck.id).owner_id = userIdFor(OTHER);
  rowOf(trasherDeck.id).created_by_user_id = userIdFor(OTHER);
  const trasher = sessionFor(OWNER, { isAdmin: false });
  assert.equal(
    (await request('POST', `${trasherDeck.id}/restore`, trasher)).statusCode,
    200,
  );
});

test('unrelated actor cannot restore or see another person’s trash', async () => {
  const pres = await deck();
  const other = sessionFor(OTHER, { isAdmin: false });
  const denied = await request('POST', `${pres.id}/restore`, other);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.error, 'forbidden');
  assert.ok(rowOf(pres.id).trashed_at);
  const trash = await request('GET', 'trash', other);
  assert.ok(!trash.body.some((item) => item.id === pres.id));
});

test('absent deck is 404 and a live deck is 409', async () => {
  const absent = await request('POST', `${ABSENT}/restore`);
  assert.equal(absent.statusCode, 404);
  const live = await deck({ trashed: false });
  const refused = await request('POST', `${live.id}/restore`);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error, 'not_trashed');
});
