/**
 * Removing a language version (DY-874): `DELETE
 * /api/presentations/:id/languages/:lang`, through `removeLanguageVersion`.
 *
 * Pinned: the source version is refused, a version the deck does not have is
 * refused, the removal leaves the other versions byte-equal, and the deck as it
 * was is in version history first, restorable with every version.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { testScope } from './helpers/storage-scope.js';
import { seedRow } from './helpers/theme-seed.js';
import { sessionFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = 'deckyard-test-dy874'.padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const OWNER = 'owner@example.com';
const OTHER = 'other@example.com';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const {
  createPresentation,
  getPresentation,
  listPresentationVersions,
  updatePresentation,
} = await import('../server/storage/presentations/index.js');
const { handlePresentations } =
  await import('../server/routes/api/presentations/index.js');

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      users: userRows(OWNER, OTHER),
      themes: [await seedRow('brand')],
    }),
  );
  await initializeStorage();
});

test.after(() => {
  __setTestDb(null);
});

const slide = (title) => ({
  id: 's1',
  type: 'title-slide',
  content: { title },
});

/** A Dutch deck with an English version whose title is past any limit. */
async function bilingualDeck() {
  const scope = testScope(process.cwd());
  const pres = await createPresentation(scope, {
    title: 'Het deck',
    ownerEmail: OWNER,
  });
  // An English version the way a translation leaves it: a title past any
  // field limit, stored by a write that does not validate fields.
  return updatePresentation(scope, pres.id, {
    title: 'Het deck',
    slides: [slide('Een titel')],
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: {
        nl: { title: 'Het deck', slides: [slide('Een titel')] },
        'en-GB': { title: 'The deck', slides: [slide('E'.repeat(200))] },
      },
    },
  });
}

async function request(
  method,
  path,
  actor = sessionFor(OWNER, { isAdmin: false }),
) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = {};
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

test('removing a version leaves a one-language deck and the source byte-equal', async () => {
  const pres = await bilingualDeck();
  const scope = testScope(process.cwd());
  const before = await getPresentation(scope, pres.id);
  const nlBefore = JSON.stringify(before.i18n.versions.nl);

  const res = await request('DELETE', `${pres.id}/languages/en-GB`);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.lang, 'en-GB');
  assert.ok(res.body.versionId, 'the backup snapshot is named');

  const after = await getPresentation(scope, pres.id);
  assert.deepEqual(Object.keys(after.i18n.versions), ['nl']);
  assert.equal(JSON.stringify(after.i18n.versions.nl), nlBefore);
  assert.equal(after.i18n.dominant, 'nl');
  assert.equal(after.title, 'Het deck');

  const versions = await listPresentationVersions(scope, pres.id);
  const backup = versions.find((v) => v.id === res.body.versionId);
  assert.equal(backup.reason, 'pre_language_removal');
});

test('the backup restores every version', async () => {
  const pres = await bilingualDeck();
  const removed = await request('DELETE', `${pres.id}/languages/en-GB`);
  const scope = testScope(process.cwd());
  const current = await getPresentation(scope, pres.id);
  const req = Readable.from([]);
  req.method = 'POST';
  req.headers = { 'if-match': String(current.revision) };
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
  await handlePresentations({
    repoRoot: process.cwd(),
    storageScope: scope,
    req,
    res,
    url: new URL(
      `http://test.local/api/presentations/${pres.id}/versions/${removed.body.versionId}/restore`,
    ),
    authedUser: sessionFor(OWNER, { isAdmin: false }),
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const restored = await getPresentation(scope, pres.id);
  assert.deepEqual(Object.keys(restored.i18n.versions).sort(), ['en-GB', 'nl']);
});

test('the source version and a version the deck lacks are refused', async () => {
  const pres = await bilingualDeck();
  const source = await request('DELETE', `${pres.id}/languages/nl`);
  assert.equal(source.statusCode, 400);
  assert.equal(source.body.error, 'invalid');
  assert.equal(source.body.details.field, 'lang');

  const absent = await request('DELETE', `${pres.id}/languages/de`);
  assert.equal(absent.statusCode, 400);

  const unknown = await request('DELETE', `${pres.id}/languages/%E0%A4%A`);
  assert.equal(unknown.statusCode, 400);

  const scope = testScope(process.cwd());
  const after = await getPresentation(scope, pres.id);
  assert.deepEqual(Object.keys(after.i18n.versions).sort(), ['en-GB', 'nl']);
});

test('an actor without write access removes nothing', async () => {
  const pres = await bilingualDeck();
  const res = await request(
    'DELETE',
    `${pres.id}/languages/en-GB`,
    sessionFor(OTHER, { isAdmin: false }),
  );
  assert.ok([403, 404].includes(res.statusCode), String(res.statusCode));
  const after = await getPresentation(testScope(process.cwd()), pres.id);
  assert.ok(after.i18n.versions['en-GB']);
});
