/**
 * B482: a library create refuses a language version under a non-canonical key.
 *
 * B481 closed the deck seam; the library had its own. `createSlideLibraryRow`
 * wrote the `i18n` of a POST as-is, so `i18n.versions.en` landed on the shelf
 * where `pickVersion` (which reads the canonical key only) never finds it.
 * Create is the only library write that carries `i18n` (a PATCH derives it
 * from `content`, D170), and it now runs the same check as the deck seam:
 * 400 `invalid`, `details.field` = `i18n.versions`, nothing written.
 *
 * The canonical key `en-GB` stored and read back is pinned against real
 * PostgreSQL in tests/pg/slide-library-i18n-storage.pgtest.js (this file's
 * fake db has no insert for the library row).
 *
 * Run with: node --test tests/slide-library-canonical-version-key.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';
import { sessionFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { handleSlideLibrary } =
  await import('../server/routes/api/slide-library.js');
const { listPersonalLibrary, listOrganizationLibrary } =
  await import('../server/storage/slide-library.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** A create body whose one extra version sits under `key`. */
function bodyWithVersion(key) {
  return {
    name: 'Citaat',
    slideType: 'quote-slide',
    content: { quote: 'Hallo' },
    i18n: {
      dominant: 'nl',
      versions: {
        nl: { content: { quote: 'Hallo' } },
        [key]: { content: { quote: 'Hello' } },
      },
    },
  };
}

function post(shelf, body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  const res = {
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
  return handleSlideLibrary({
    repoRoot: process.cwd(),
    storageScope: testScope(),
    req: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() {
        yield buf;
      },
    },
    res,
    url: new URL(`http://test.local/api/slide-library/${shelf}`),
    authedUser: sessionFor(OWNER, { isAdmin: false }),
  }).then(() => res);
}

async function shelfItems(shelf) {
  const out =
    shelf === 'personal'
      ? await listPersonalLibrary(testScope(), OWNER)
      : await listOrganizationLibrary(testScope(), { userEmail: OWNER });
  return out.items;
}

for (const shelf of ['personal', 'organization']) {
  test(`${shelf} create refuses i18n.versions.en and writes nothing`, async () => {
    const before = (await shelfItems(shelf)).length;
    const res = await post(shelf, bodyWithVersion('en'));

    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(res.body.error, 'invalid');
    assert.deepEqual(res.body.details, { field: 'i18n.versions' });
    assert.match(res.body.message, /"en".*"en-GB"/);
    assert.equal((await shelfItems(shelf)).length, before);
  });

  test(`${shelf} create refuses an off-axis key`, async () => {
    const before = (await shelfItems(shelf)).length;
    const res = await post(shelf, bodyWithVersion('xx'));

    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.deepEqual(res.body.details, { field: 'i18n.versions' });
    assert.equal((await shelfItems(shelf)).length, before);
  });
}

test('a dominant off the axis is refused: a content PATCH would mint it as a key', async () => {
  const body = bodyWithVersion('en-GB');
  body.i18n.dominant = 'xx';
  const res = await post('personal', body);

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'invalid');
  assert.deepEqual(res.body.details, { field: 'i18n.dominant' });
});
