/**
 * Public API v1: a deck's timestamps are `createdAt`/`updatedAt`, and they are
 * real (B448).
 *
 * `openapi.yaml` promised `createdAt`/`updatedAt` as `date-time`, but the
 * response read those names off a storage object that projects the columns as
 * `created`/`modified`, so every deck answered `null` on GET, list, create,
 * PUT, the AI wizard and a slide update. The same two names split storage
 * itself: the shared-with-me list said `createdAt`/`updatedAt` while every
 * other presentation projection said `created`/`modified`, and the MCP deck
 * list read both. These tests pin the one shape: storage says
 * `created`/`modified`, v1 renames it once at its boundary, and no response
 * carries both spellings.
 *
 * Runs against the in-memory database double (tests/helpers/fake-db.js).
 *
 * Run with: node --test tests/public-api-timestamps.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { userIdFor, userRows } from './helpers/identity-fixtures.js';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/lifecycle.js');
const { handlePresentations } =
  await import('../server/routes/public-api/v1/presentations.js');
const { handleSlides } =
  await import('../server/routes/public-api/v1/slides.js');
const { presentationTimestamps } =
  await import('../server/routes/public-api/v1/deck-fields.js');

/** A fresh, empty database double behind the storage facade. */
async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(OWNER),
  });
  __setTestDb(db);
  await initializeStorage(process.cwd());
  return db;
}

/**
 * Request context for a v1 router, key already authenticated.
 * @param {string} method
 * @param {string} pathname
 * @param {Object|null} [body]
 * @returns {Object} ctx, with `res.statusCode` / `res.body` recorded
 */
function makeCtx(method, pathname, body = null) {
  const req = Readable.from(
    body === null ? [] : [Buffer.from(JSON.stringify(body))],
  );
  req.method = method;
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
  return {
    req,
    res,
    url: new URL(`http://localhost${pathname}`),
    repoRoot: process.cwd(),
    storageScope: {
      repoRoot: process.cwd(),
      organizationId: ORG,
      actorUserId: userIdFor(OWNER),
      actorEmail: OWNER,
    },
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
  };
}

/** Run one request through a router and return the recorded response. */
async function call(handler, method, pathname, body = null) {
  const ctx = makeCtx(method, pathname, body);
  await handler(ctx);
  return ctx.res;
}

/**
 * Assert a v1 presentation object carries real timestamps under the published
 * names, and never the storage spelling beside them.
 * @param {Object} pres
 * @param {string} where - which response, for the failure message
 */
function assertTimestamps(pres, where) {
  assert.match(String(pres.createdAt), ISO, `${where}: createdAt`);
  assert.match(String(pres.updatedAt), ISO, `${where}: updatedAt`);
  assert.ok(!('created' in pres), `${where}: no storage name \`created\``);
  assert.ok(!('modified' in pres), `${where}: no storage name \`modified\``);
}

/** Create a deck through v1 and return the response presentation. */
async function create(title) {
  const res = await call(handlePresentations, 'POST', '/api/v1/presentations', {
    title,
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.presentation;
}

test('create, GET and list answer real createdAt/updatedAt', async () => {
  await installDb();
  const pres = await create('Stamps');
  assertTimestamps(pres, 'create');

  const got = await call(
    handlePresentations,
    'GET',
    `/api/v1/presentations/${pres.id}`,
  );
  assert.equal(got.statusCode, 200);
  assertTimestamps(got.body.presentation, 'GET');
  assert.equal(got.body.presentation.createdAt, pres.createdAt);

  const list = await call(handlePresentations, 'GET', '/api/v1/presentations');
  const listed = list.body.presentations.find((p) => p.id === pres.id);
  assertTimestamps(listed, 'list');
});

test('PUT answers the new updatedAt and keeps createdAt', async () => {
  const db = await installDb();
  const pres = await create('Before');
  // Age the stored row so the write's new timestamp is observable.
  const row = db.__tables.presentations.find((r) => r.id === pres.id);
  row.created_at = row.modified_at = '2026-01-01T00:00:00.000Z';

  const res = await call(
    handlePresentations,
    'PUT',
    `/api/v1/presentations/${pres.id}`,
    { title: 'After' },
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assertTimestamps(res.body.presentation, 'PUT');
  assert.equal(res.body.presentation.createdAt, '2026-01-01T00:00:00.000Z');
  assert.notEqual(
    res.body.presentation.updatedAt,
    '2026-01-01T00:00:00.000Z',
    'the write moved updatedAt',
  );
});

test('a slide update answers the deck updatedAt', async () => {
  await installDb();
  const pres = await create('Slides');
  const added = await call(
    handleSlides,
    'POST',
    `/api/v1/presentations/${pres.id}/slides`,
    { type: 'title-slide', content: { title: 'Hoi' } },
  );
  assert.equal(added.statusCode, 201, JSON.stringify(added.body));

  const res = await call(
    handleSlides,
    'PUT',
    `/api/v1/presentations/${pres.id}/slides/${added.body.slide.id}`,
    { content: { title: 'Hallo' } },
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(String(res.body.presentation.updatedAt), ISO);
});

// The AI wizard's success path needs a configured LLM vendor, which has no
// test seam (the B40 opt-out in tests/public-api-v1-ai.test.js). Its response
// builds the timestamps with this same projection, so pinning the projection
// covers the rename it does.
test('the projection renames storage fields once, and only publishes the v1 names', () => {
  const stamps = presentationTimestamps({
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-02-01T00:00:00.000Z',
    createdAt: 'stale',
    updatedAt: 'stale',
  });
  assert.deepEqual(stamps, {
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  });
  assert.deepEqual(presentationTimestamps({}), {
    createdAt: null,
    updatedAt: null,
  });
});
