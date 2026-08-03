/**
 * Regression: the three optimistic-lock catch blocks on the presentation write
 * routes now emit the canonical error envelope.
 *
 * PUT /:id, PATCH /:id/scope and POST /:id/versions/:v/restore each wrap their
 * updatePresentation() call in a catch that used to serve a hand-rolled body
 * (`{ error: <prose>, details }`) — no `ok:false`, the human message sitting in
 * the machine-code slot, and (because these handlers are not wrapped in
 * withErrorHandler) no other layer to normalize it. The catch now runs the error
 * through errorToResponse(), producing the canonical envelope
 * (`{ ok:false, error:'<code>', message, details }`) with the stable `conflict`
 * code and the details preserved.
 *
 * Each test forces a real ConflictError by sending a stale If-Match revision, so
 * the assertions go red against the old hand-rolled body.
 *
 * Run with: node --test tests/presentation-conflict-envelope.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
// `__resetStorageForTests` rather than `closeStorage`: the double is not a real
// Kysely handle, so closing it would call a `destroy()` it does not have.
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { createPresentation, createPresentationVersion } = await import(
  '../server/storage/presentations/index.js'
);
const { handlePresentationItem } = await import(
  '../server/routes/api/presentations/presentation.js'
);
const { handlePresentationScope } = await import(
  '../server/routes/api/presentations/scope.js'
);
const { handlePresentationRestoreVersion } = await import(
  '../server/routes/api/presentations/restore.js'
);

const OWNER = 'owner@example.com';
// A revision that will never match a freshly-seeded deck (revision 1), so the
// optimistic-lock check throws a ConflictError instead of writing.
const STALE_REVISION = '999';

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

/** A request whose body streams `body` as JSON, with the given method/headers. */
function fakeReq({ method = 'PUT', headers = {}, body = null } = {}) {
  const buf = Buffer.from(body == null ? '' : JSON.stringify(body), 'utf8');
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

/** Create a fresh deck owned by OWNER; returns the stored presentation. */
async function seedDeck() {
  return createPresentation(testScope(), {
    title: 'Conflict deck',
    ownerEmail: OWNER,
    slides: [{ id: 's1', type: 'content-slide', content: { title: 'A', body: 'Hello' } }],
  });
}

const owner = { email: OWNER, isAdmin: false };

/** Assert a body is the canonical conflict envelope with details preserved. */
function assertConflictEnvelope(res, presId) {
  assert.equal(res.statusCode, 409, 'a stale If-Match is a 409 conflict');
  const body = res.json();
  assert.equal(body.ok, false, 'envelope carries ok:false');
  assert.equal(body.error, 'conflict', 'machine code, not prose, in error');
  assert.equal(
    typeof body.message,
    'string',
    'human message moved to the message field'
  );
  assert.ok(body.message.length > 0, 'message is non-empty');
  // The revision details the client needs for conflict resolution survive.
  assert.ok(body.details, 'details preserved');
  assert.equal(body.details.id, presId, 'details carry the presentation id');
  assert.equal(typeof body.details.revision, 'number', 'details carry the revision');
}

test('PUT /:id conflict emits the canonical envelope', async () => {
  const pres = await seedDeck();
  const res = fakeRes();
  await handlePresentationItem(
    {
      storageScope: testScope(),
      req: fakeReq({
        method: 'PUT',
        headers: { 'if-match': STALE_REVISION },
        body: { ...pres, title: 'Changed' },
      }),
      res,
      url: `/api/presentations/${pres.id}`,
      authedUser: owner,
    },
    pres.id
  );
  assertConflictEnvelope(res, pres.id);
});

test('PATCH /:id/scope conflict emits the canonical envelope', async () => {
  const pres = await seedDeck();
  const res = fakeRes();
  await handlePresentationScope(
    {
      storageScope: testScope(),
      req: fakeReq({
        method: 'PATCH',
        headers: { 'if-match': STALE_REVISION },
        body: { scope: 'workspace' },
      }),
      res,
      authedUser: owner,
    },
    pres.id
  );
  assertConflictEnvelope(res, pres.id);
});

test('POST /:id/versions/:v/restore conflict emits the canonical envelope', async () => {
  const pres = await seedDeck();
  const version = await createPresentationVersion(testScope(), pres.id, pres, {
    actorEmail: OWNER,
  });
  const res = fakeRes();
  await handlePresentationRestoreVersion(
    {
      storageScope: testScope(),
      req: fakeReq({
        method: 'POST',
        headers: { 'if-match': STALE_REVISION },
        body: {},
      }),
      res,
      authedUser: owner,
    },
    pres.id,
    version?.id
  );
  assertConflictEnvelope(res, pres.id);
});
