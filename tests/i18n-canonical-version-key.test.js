/**
 * B481: the write seam refuses a language version under a non-canonical key.
 *
 * `normalizeI18n` only visited the keys of `TRANSLATION_LANGS`, so a PUT with
 * `i18n.versions.en` was stored as-is. `pickVersion` reads the canonical key
 * only, so that version was invisible to the reader and the publish gate, while
 * `existingVersionLangs` normalized the key and reported it as `en-GB`: one
 * deck, two answers. The seam now refuses the write (refuse over repair), with
 * `details.field`, on both the app PUT and API v1; and `existingVersionLangs`
 * reads keys as exactly as `pickVersion` does.
 *
 * Run with: node --test tests/i18n-canonical-version-key.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { testScope } from './helpers/storage-scope.js';
import {
  sessionFor,
  userIdFor,
  userRows,
} from './helpers/identity-fixtures.js';

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
const { createPresentation, getPresentation } =
  await import('../server/storage/presentations/index.js');
const { handlePresentations: handleAppPresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handlePresentations: handleV1Presentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { existingVersionLangs, pickVersion } =
  await import('../shared/i18n-progress.js');

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

const slide = (title) => ({
  id: 's1',
  type: 'content-slide',
  content: { title, body: '' },
});

async function seedDeck() {
  return createPresentation(testScope(), {
    title: 'Dek',
    lang: 'nl',
    ownerEmail: OWNER,
    slides: [slide('Hallo')],
  });
}

/** The deck as the editor would send it back, with one extra version. */
function withVersion(pres, key) {
  return {
    ...pres,
    i18n: {
      ...pres.i18n,
      versions: {
        ...pres.i18n.versions,
        [key]: { title: 'Deck', slides: [slide('Hello')] },
      },
    },
  };
}

function appPut(pres, body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  const res = {
    statusCode: null,
    body: null,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
  return handleAppPresentations({
    storageScope: testScope(),
    req: {
      method: 'PUT',
      headers: { 'if-match': String(pres.revision) },
      async *[Symbol.asyncIterator]() {
        yield buf;
      },
    },
    res,
    url: new URL(`http://test.local/api/presentations/${pres.id}`),
    authedUser: sessionFor(OWNER, { isAdmin: false }),
  }).then(() => res);
}

function v1Put(pres, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'PUT';
  req.headers = { 'content-type': 'application/json' };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
  const scope = testScope();
  return handleV1Presentations({
    req,
    res,
    url: new URL(`http://localhost/api/v1/presentations/${pres.id}`),
    repoRoot: process.cwd(),
    storageScope: scope,
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: {
      id: userIdFor(OWNER),
      email: OWNER,
      role: 'user',
      organizationId: ORG,
    },
  }).then(() => res);
}

test('app PUT refuses i18n.versions.en and names the field', async () => {
  const pres = await seedDeck();
  const res = await appPut(pres, withVersion(pres, 'en'));

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'invalid');
  assert.deepEqual(res.body.details, { field: 'i18n.versions' });
  assert.match(res.body.message, /"en".*"en-GB"/);

  const stored = await getPresentation(testScope(), pres.id);
  assert.deepEqual(Object.keys(stored.i18n.versions), ['nl']);
});

test('API v1 PUT refuses i18n.versions.en and names the field', async () => {
  const pres = await seedDeck();
  const res = await v1Put(pres, { i18n: withVersion(pres, 'en').i18n });

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'invalid');
  assert.deepEqual(res.body.details, { field: 'i18n.versions' });

  const stored = await getPresentation(testScope(), pres.id);
  assert.deepEqual(Object.keys(stored.i18n.versions), ['nl']);
});

test('an off-axis key is refused too', async () => {
  const pres = await seedDeck();
  const res = await v1Put(pres, { i18n: withVersion(pres, 'xx').i18n });

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.deepEqual(res.body.details, { field: 'i18n.versions' });
});

test('the canonical key en-GB is stored, and every reader sees it', async () => {
  const pres = await seedDeck();

  const res = await appPut(pres, withVersion(pres, 'en-GB'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const stored = await getPresentation(testScope(), pres.id);
  assert.deepEqual(existingVersionLangs(stored), ['nl', 'en-GB']);
  assert.equal(pickVersion(stored, 'en-GB').title, 'Deck');

  const v1 = await v1Put(stored, { i18n: stored.i18n });
  assert.equal(v1.statusCode, 200, JSON.stringify(v1.body));
});

test('existingVersionLangs reads keys as exactly as pickVersion does', () => {
  const pres = {
    title: 'Top',
    slides: [],
    i18n: {
      versions: {
        nl: { title: 'Dek', slides: [] },
        en: { title: 'Deck', slides: [] },
      },
    },
  };
  // `en` is not a version pickVersion can reach, so it is not one the deck
  // offers either.
  assert.deepEqual(existingVersionLangs(pres), ['nl']);
  assert.equal(pickVersion(pres, 'en-GB').title, 'Top');
});
