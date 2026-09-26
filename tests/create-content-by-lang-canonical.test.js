/**
 * B483: a create refuses a `contentByLang` key that is not a canonical deck
 * language.
 *
 * `prepareNewPresentation` turns each `slides[].contentByLang` key into an
 * `i18n.versions` key, but it looked the languages up through
 * `TRANSLATION_LANGS` only: `contentByLang.en` (or a key off the axis) was
 * dropped without a word and the deck missed that version. The factory now
 * runs the check the version keys pass (B481): 400 `invalid`,
 * `details.field` = `slides`, nothing written. Not dropped, not renamed.
 *
 * Run with: node --test tests/create-content-by-lang-canonical.test.js
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
const { listPresentations } =
  await import('../server/storage/presentations/index.js');
const { handlePresentations: handleAppPresentations } =
  await import('../server/routes/api/presentations/index.js');
const { handlePresentations: handleV1Presentations } =
  await import('../server/routes/public-api/v1/presentations.js');

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

/** A create body whose second slide carries its English under `key`. */
function bodyWith(key) {
  return {
    title: 'Dek',
    lang: 'nl',
    slides: [
      { type: 'content-slide', content: { title: 'Eerste', body: '' } },
      {
        type: 'content-slide',
        content: { title: 'Hallo', body: '' },
        contentByLang: {
          nl: { title: 'Hallo', body: '' },
          [key]: { title: 'Hello', body: '' },
        },
      },
    ],
  };
}

function appPost(body) {
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
  return handleAppPresentations({
    storageScope: testScope(),
    req: {
      method: 'POST',
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield buf;
      },
    },
    res,
    url: new URL('http://test.local/api/presentations'),
    authedUser: sessionFor(OWNER, { isAdmin: false }),
  }).then(() => res);
}

function v1Post(body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST';
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
  return handleV1Presentations({
    req,
    res,
    url: new URL('http://localhost/api/v1/presentations'),
    repoRoot: process.cwd(),
    storageScope: testScope(),
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

async function deckCount() {
  return (await listPresentations(testScope())).length;
}

test('app create refuses contentByLang.en, names the field and writes nothing', async () => {
  const before = await deckCount();
  const res = await appPost(bodyWith('en'));

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'invalid');
  assert.deepEqual(res.body.details, { field: 'slides' });
  assert.match(res.body.message, /slides\[1\]\.contentByLang.*"en".*"en-GB"/);
  assert.equal(await deckCount(), before);
});

test('API v1 create refuses contentByLang.en and writes nothing', async () => {
  const before = await deckCount();
  const res = await v1Post(bodyWith('en'));

  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'invalid');
  assert.deepEqual(res.body.details, { field: 'slides' });
  assert.equal(await deckCount(), before);
});

test('an off-axis contentByLang key is refused on both routes', async () => {
  const before = await deckCount();
  for (const send of [appPost, v1Post]) {
    const res = await send(bodyWith('xx'));
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.deepEqual(res.body.details, { field: 'slides' });
    assert.match(res.body.message, /use one of nl, en-GB/);
  }
  assert.equal(await deckCount(), before);
});

test('canonical contentByLang keys still build one version per language', async () => {
  // The app answers the deck itself, API v1 wraps it in `presentation`.
  for (const [send, deckOf] of [
    [appPost, (body) => body],
    [v1Post, (body) => body.presentation],
  ]) {
    const res = await send(bodyWith('en-GB'));
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const { versions } = deckOf(res.body).i18n;
    assert.deepEqual(Object.keys(versions).sort(), ['en-GB', 'nl']);
    assert.equal(versions['en-GB'].slides[1].content.title, 'Hello');
    // A slide without contentByLang falls back to its flat content.
    assert.equal(versions['en-GB'].slides[0].content.title, 'Eerste');
  }
});
