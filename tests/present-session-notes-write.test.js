/**
 * The notes companion is authorized by the present-session id and nothing else.
 *
 * `GET /api/present-sessions/:sessionId/deck` and
 * `PUT /api/present-sessions/:sessionId/notes/:slideId` are capability-based:
 * whoever holds the join link may read this session's deck and edit its speaker
 * notes, logged in or not. These tests drive the real handlers against the
 * Postgres adapter on the in-memory database double and pin the boundary:
 *
 * - a valid session reads the deck and writes one slide's notes;
 * - an unknown session is a 404 on both, so a wrong id never addresses a deck;
 * - the write lands on `session.presentationId` only, and only on `notes`;
 * - a slide the deck does not have is a 404, not a silent no-op;
 * - an author-locked slide is refused (423);
 * - a successful write broadcasts `deckUpdated` to the session's SSE clients.
 *
 * Run with: node --test tests/present-session-notes-write.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } = await import(
  '../server/storage/adapters/index.js'
);
const { createPresentation, getPresentation, updatePresentation } = await import(
  '../server/storage/presentations/index.js'
);
const { createPresentSession, getPresentSession } = await import(
  '../server/storage/present-sessions/sessions.js'
);
const { handlePresentSessionsPublic } = await import(
  '../server/routes/api/present-session-audience.js'
);
const { resetRateLimitBuckets } = await import('../server/utils/rate-limit.js');

const OWNER = 'owner@example.com';
const REPO_ROOT = '/tmp/deckyard-companion-notes-test';

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default', slug: 'default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

test.beforeEach(() => {
  // The write is IP-throttled and every request here carries the same (absent)
  // IP, so the bucket has to start full for each case.
  resetRateLimitBuckets();
});

/** A request whose body streams `body` as JSON. */
function fakeReq({ method = 'PUT', headers = {}, body = null } = {}) {
  const buf = Buffer.from(body == null ? '' : JSON.stringify(body), 'utf8');
  return {
    method,
    headers,
    socket: {},
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
  };
}

function fakeSseClient() {
  const chunks = [];
  return {
    writable: true,
    writableEnded: false,
    write(message) {
      chunks.push(message);
      return true;
    },
    on() {},
    text: () => chunks.join(''),
  };
}

/** Parse a JSON response body written through `serveJson`. */
function jsonBody(res) {
  return JSON.parse(String(res.body || '{}'));
}

/** Drive the public dispatcher for one request. */
async function call({ method, path, body }) {
  const res = fakeRes();
  const handled = await handlePresentSessionsPublic({
    repoRoot: REPO_ROOT,
    req: fakeReq({ method, body }),
    res,
    url: new URL(path, 'http://localhost'),
  });
  return { res, handled };
}

/**
 * A deck with two slides and a live session on it.
 *
 * `createPresentation` mints its own slide ids, so the caller gets the stored
 * ones back rather than the ones it asked for.
 */
async function seedSessionDeck({ slides } = {}) {
  const pres = await createPresentation(testScope(), {
    title: 'Companion deck',
    ownerEmail: OWNER,
    slides: slides || [
      { type: 'content-slide', content: { title: 'A' }, notes: 'first' },
      { type: 'content-slide', content: { title: 'B' }, notes: '' },
    ],
  });
  const session = await createPresentSession(REPO_ROOT, { presentationId: pres.id });
  return { pres, sessionId: session.sessionId, slideIds: pres.slides.map((s) => s.id) };
}

test('GET /deck answers the session deck without any login', async () => {
  const { pres, sessionId } = await seedSessionDeck();
  const { res, handled } = await call({
    method: 'GET',
    path: `/api/present-sessions/${sessionId}/deck`,
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const out = jsonBody(res);
  assert.equal(out.id, pres.id);
  assert.equal(out.presentationId, pres.id);
  assert.equal(out.slides.length, 2);
  assert.equal(out.slides[0].notes, 'first', 'notes travel with the slides');
  // Narrower than the authenticated deck read: a join link is not a login.
  assert.equal(out.ownerEmail, undefined);
  assert.equal(out.settings, undefined);
});

test('GET /deck for an unknown session is a 404', async () => {
  const { res } = await call({
    method: 'GET',
    path: '/api/present-sessions/00000000-0000-0000-0000-00000000dead/deck',
  });
  assert.equal(res.statusCode, 404);
});

test('PUT /notes/:slideId writes exactly that slide\'s notes', async () => {
  const { pres, sessionId, slideIds } = await seedSessionDeck();
  const { res } = await call({
    method: 'PUT',
    path: `/api/present-sessions/${sessionId}/notes/${slideIds[1]}`,
    body: { notes: 'Remember the demo.' },
  });
  assert.equal(res.statusCode, 200);

  const after = await getPresentation(testScope(), pres.id);
  const [s1, s2] = after.slides;
  assert.equal(s2.notes, 'Remember the demo.');
  assert.equal(s1.notes, 'first', 'the other slide is untouched');
  assert.deepEqual(s2.content, { title: 'B' }, 'only notes changed');
  assert.equal(after.title, 'Companion deck', 'the rest of the deck is untouched');
});

test('PUT /notes for an unknown session is a 404 and writes nothing', async () => {
  const { pres, slideIds } = await seedSessionDeck();
  const { res } = await call({
    method: 'PUT',
    path: `/api/present-sessions/00000000-0000-0000-0000-00000000dead/notes/${slideIds[0]}`,
    body: { notes: 'should not land' },
  });
  assert.equal(res.statusCode, 404);
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.slides[0].notes, 'first');
});

test('PUT /notes for a slide this deck does not have is a 404', async () => {
  const { sessionId } = await seedSessionDeck();
  const { res } = await call({
    method: 'PUT',
    path: `/api/present-sessions/${sessionId}/notes/not-a-slide`,
    body: { notes: 'nowhere' },
  });
  assert.equal(res.statusCode, 404);
});

test('PUT /notes rejects a non-string body', async () => {
  const { sessionId, slideIds } = await seedSessionDeck();
  const { res } = await call({
    method: 'PUT',
    path: `/api/present-sessions/${sessionId}/notes/${slideIds[0]}`,
    body: { notes: 42 },
  });
  assert.equal(res.statusCode, 400);
});

test('PUT /notes refuses an author-locked slide (423)', async () => {
  const { pres, sessionId, slideIds } = await seedSessionDeck({
    slides: [{ type: 'content-slide', content: { title: 'A' }, notes: 'locked notes' }],
  });
  // `createPresentation` does not carry `lockedByAuthor` through, so the author
  // sets the lock the way the editor does: a write of their own.
  await updatePresentation(
    testScope(null, { actorEmail: OWNER }),
    pres.id,
    { slides: pres.slides.map((s) => ({ ...s, lockedByAuthor: true })) },
    { actorEmail: OWNER, user: { email: OWNER } }
  );

  const { res } = await call({
    method: 'PUT',
    path: `/api/present-sessions/${sessionId}/notes/${slideIds[0]}`,
    body: { notes: 'trying anyway' },
  });
  assert.equal(res.statusCode, 423, 'the companion is never the author');
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.slides[0].notes, 'locked notes', 'the write did not land');
});

test('a successful write broadcasts deckUpdated to the session', async () => {
  const { sessionId, slideIds } = await seedSessionDeck();
  const session = await getPresentSession(REPO_ROOT, sessionId);
  const client = fakeSseClient();
  session.clients.add(client);

  const { res } = await call({
    method: 'PUT',
    path: `/api/present-sessions/${sessionId}/notes/${slideIds[0]}`,
    body: { notes: 'now the editor should hear about it' },
  });
  assert.equal(res.statusCode, 200);

  // The broadcast is fire-and-forget; allow it to flush.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(client.text(), /event: deckUpdated/);
});

test('re-writing the same notes is a no-op that does not bump the revision', async () => {
  const { pres, sessionId, slideIds } = await seedSessionDeck();
  const before = await getPresentation(testScope(), pres.id);
  const { res } = await call({
    method: 'PUT',
    path: `/api/present-sessions/${sessionId}/notes/${slideIds[0]}`,
    body: { notes: 'first' },
  });
  assert.equal(res.statusCode, 200);
  const after = await getPresentation(testScope(), pres.id);
  assert.equal(after.revision, before.revision);
});
