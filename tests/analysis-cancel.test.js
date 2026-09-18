/**
 * Cancelling an AI analysis stops the server, not just the browser (B338).
 *
 * The analyze modal cancels by aborting its fetch, which closes the SSE stream.
 * Before B338 the route never noticed: the model call ran to completion and
 * every suggestion was still stored as a comment and broadcast to live viewers.
 * Now the stream's disconnect signal reaches the provider fetch and is checked
 * before each comment is created. Pinned at both moments a cancel can land:
 *
 *   - during the model call: the provider fetch receives the signal and is
 *     aborted; nothing is stored, nothing broadcast;
 *   - during comment creation: the comment whose write was under way is kept
 *     (and broadcast, so live viewers match storage), the rest is never
 *     written.
 *
 * House shape: the exported handler is called directly with a req/res double
 * over `tests/helpers/fake-db.js`, so a client disconnect is `res.emit('close')`
 * at an exact moment instead of a race over a socket. The real-socket half
 * (a disconnect after the body was read reaches the signal at all) lives in
 * `tests/sse-open-stream.test.js`.
 *
 * Run with: node --test tests/analysis-cancel.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.SANDBOX_MODE;
process.env.OPENAI_API = 'test-key';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const DECK = 'deck-analyzed';
const OWNER = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Olive Owner',
  organizationId: ORG,
};

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handlePresentationAnalyze } =
  await import('../server/routes/api/presentations/analyze.js');
const commentEvents = await import('../server/services/comment-events.js');

/** @type {ReturnType<typeof createFakeDb>} */
let db;

test.before(async () => {
  __setTestDb(createFakeDb({ organizations: [{ id: ORG, name: 'Default' }] }));
  await initializeStorage();
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

function seed() {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: OWNER.id,
        organization_id: ORG,
        email: OWNER.email,
        name: OWNER.name,
        role: 'user',
        auth_source: 'database',
        password_hash: null,
        settings: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    presentations: [
      {
        id: DECK,
        organization_id: ORG,
        title: 'Analyzed deck',
        owner_email: OWNER.email,
        created_by: OWNER.email,
        updated_by: OWNER.email,
        owner_user_id: OWNER.id,
        created_by_user_id: OWNER.id,
        updated_by_user_id: OWNER.id,
        visibility: 'private',
        theme: 'default',
        lang: 'en',
        revision: 1,
        is_view_only: false,
        slides: ['s1', 's2', 's3'].map((id) => ({
          id,
          type: 'content-slide',
          content: { title: `Slide ${id}` },
        })),
        i18n: null,
        settings: {},
        created_at: '2026-02-01T00:00:00.000Z',
        modified_at: '2026-02-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
    presentation_collaborators: [],
    presentation_comments: [],
  });
  __setTestDb(db);
}

const storedComments = () => db.__tables.presentation_comments || [];

/** A response double that behaves like an SSE `ServerResponse`. */
function makeSseRes() {
  const res = new EventEmitter();
  res.writable = true;
  res.writableEnded = false;
  res.writableFinished = false;
  res.events = [];
  res.writeHead = (status) => {
    res.statusCode = status;
  };
  res.flushHeaders = () => {};
  res.write = (chunk) => {
    const event = /^event: (.+)$/m.exec(String(chunk))?.[1];
    if (event) res.events.push(event);
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
    res.writable = false;
  };
  return res;
}

/**
 * The client leaving mid-stream: what the socket does when the modal's
 * `controller.abort()` lands.
 */
function disconnect(res) {
  res.writable = false;
  res.emit('close');
}

/** Run the handler against a fresh SSE response double. */
function analyze(res) {
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {},
  };
  return handlePresentationAnalyze(
    {
      storageScope: createStorageScope(OWNER, { repoRoot: process.cwd() }),
      req,
      res,
      authedUser: OWNER,
    },
    DECK,
  );
}

/** Model output with one valid suggestion per slide. */
const THREE_SUGGESTIONS = JSON.stringify({
  choices: [
    {
      message: {
        content: JSON.stringify({
          suggestions: ['s1', 's2', 's3'].map((slideId, i) => ({
            slideId,
            slideIndex: i,
            category: 'language',
            body: `Suggestion for ${slideId}`,
            proposedSlide: null,
          })),
        }),
      },
    },
  ],
});

/** Swap the global fetch (the provider's only way out) for one test. */
function stubFetch(t, impl) {
  const saved = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = saved;
  });
}

/** Watch comment broadcasts for the deck, the way a second viewer would. */
function watchBroadcasts(t, onWrite = () => {}) {
  const viewer = {
    created: 0,
    write(frame) {
      if (
        String(frame).startsWith(
          `event: ${commentEvents.CommentEventTypes.CREATED}`,
        )
      ) {
        viewer.created += 1;
        onWrite(viewer.created);
      }
    },
  };
  commentEvents.addClient(DECK, viewer);
  t.after(() => commentEvents.removeClient(DECK, viewer));
  return viewer;
}

test('cancel during the model call aborts the provider fetch and stores nothing', async (t) => {
  seed();
  const res = makeSseRes();
  const viewer = watchBroadcasts(t);

  let providerSignal = null;
  let fetchStarted;
  const started = new Promise((r) => {
    fetchStarted = r;
  });
  stubFetch(t, (_url, init) => {
    providerSignal = init.signal;
    fetchStarted();
    // A model that would answer eventually — but only if nobody cancels.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve({
            ok: true,
            status: 200,
            text: async () => THREE_SUGGESTIONS,
          }),
        5_000,
      );
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(init.signal.reason);
      });
    });
  });

  const done = analyze(res);
  await started;
  assert.ok(
    providerSignal instanceof AbortSignal,
    'the provider fetch got a signal',
  );
  assert.equal(providerSignal.aborted, false);

  disconnect(res);
  assert.equal(await done, true);

  assert.equal(providerSignal.aborted, true, 'the model call was aborted');
  assert.equal(storedComments().length, 0, 'no comment stored');
  assert.equal(viewer.created, 0, 'no comment broadcast');
  assert.ok(
    !res.events.includes('error'),
    'a cancel is not reported as a failure',
  );
});

test('cancel during comment creation stops before the next comment', async (t) => {
  seed();
  const res = makeSseRes();
  stubFetch(t, async () => ({
    ok: true,
    status: 200,
    text: async () => THREE_SUGGESTIONS,
  }));
  // The client leaves the moment the first suggestion reaches live viewers:
  // its comment is already stored, the next two are not yet.
  const viewer = watchBroadcasts(t, (count) => {
    if (count === 1) disconnect(res);
  });

  assert.equal(await analyze(res), true);

  assert.deepEqual(
    storedComments().map((c) => c.body),
    ['Suggestion for s1'],
    'only the comment written before the cancel is stored',
  );
  assert.equal(viewer.created, 1, 'nothing broadcast after the cancel');
  assert.ok(!res.events.includes('complete'), 'no completion after a cancel');
});

test('an analysis nobody cancels still stores and broadcasts every suggestion', async (t) => {
  seed();
  const res = makeSseRes();
  stubFetch(t, async () => ({
    ok: true,
    status: 200,
    text: async () => THREE_SUGGESTIONS,
  }));
  const viewer = watchBroadcasts(t);

  assert.equal(await analyze(res), true);

  assert.equal(storedComments().length, 3);
  assert.equal(viewer.created, 3);
  assert.ok(res.events.includes('complete'));
});
