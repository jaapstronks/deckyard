/**
 * The deck's live-video overlay reaches the follow-along audience (B187, D229).
 *
 * The follow view configures its video layer from the presentation it gets,
 * but `GET /api/follow/:id/presentation` never served `settings`, so an
 * overlay the presenter switched on never showed for the audience. The fix
 * serves the one setting the audience renders as `presentation.liveVideo`,
 * not the settings object (which also carries owner-side switches).
 *
 * Pinned below: an enabled overlay with a stream travels as its projection,
 * a deck without one carries `null`, and a disabled overlay does not leak its
 * stream URL.
 *
 * Route-level test in the house shape (see
 * `tests/anon-custom-theme-payload.test.js`).
 *
 * Run with: node --test tests/follow-live-video-payload.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const REPO_ROOT = '/tmp/deckyard-follow-live-video-test';
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation, updatePresentation } =
  await import('../server/storage/presentations/index.js');
const { createLiveSession, updateLiveSessionState } =
  await import('../server/storage/live-sessions/index.js');
const { handleFollowPresentation } =
  await import('../server/routes/api/follow/presentation.js');

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

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

async function seedLiveDeck(settings) {
  const pres = await createPresentation(testScope(), {
    title: 'Streamed deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides: [{ type: 'content-slide', content: { title: 'A' } }],
  });
  // A create starts from the default settings; the deck-settings modal saves
  // them afterwards, so the test does the same.
  if (settings) {
    await updatePresentation(testScope(), pres.id, {
      settings: { ...pres.settings, ...settings },
    });
  }
  const session = await createLiveSession(
    { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: null },
    { presentationId: pres.id },
  );
  await updateLiveSessionState(
    { repoRoot: REPO_ROOT, organizationId: ORG },
    session.sessionId,
    {
      slideId: pres.slides[0].id,
      slideIndex: 0,
      slideType: pres.slides[0].type,
      updatedAt: Date.now(),
    },
  );
  return pres;
}

async function followPresentation(presentationId) {
  const res = fakeRes();
  await handleFollowPresentation(
    {
      repoRoot: REPO_ROOT,
      req: { method: 'GET', headers: {}, socket: {} },
      res,
      url: new URL(
        `/api/follow/${presentationId}/presentation`,
        'http://localhost',
      ),
    },
    presentationId,
  );
  return { res, body: JSON.parse(String(res.body || '{}')) };
}

test('an enabled live video travels to the follow audience', async () => {
  const pres = await seedLiveDeck({
    analyticsEnabled: false,
    liveVideo: {
      enabled: true,
      streamUrl: ' https://www.youtube.com/watch?v=abc123 ',
      provider: 'youtube',
      defaultPosition: 'pip-bottom-left',
      mobilePosition: 'top',
    },
  });

  const { res, body } = await followPresentation(pres.id);
  assert.equal(res.statusCode, 200);
  assert.equal(body.status, 'live');
  assert.deepEqual(body.presentation.liveVideo, {
    enabled: true,
    streamUrl: 'https://www.youtube.com/watch?v=abc123',
    provider: 'youtube',
    defaultPosition: 'pip-bottom-left',
    mobilePosition: 'top',
  });
  // The setting travels on its own; the settings object stays home.
  assert.equal('settings' in body.presentation, false);
});

test('a deck without a live video carries none', async () => {
  const pres = await seedLiveDeck(null);
  const { body } = await followPresentation(pres.id);
  assert.equal(body.status, 'live');
  assert.equal(body.presentation.liveVideo, null);
});

test('a disabled live video does not leak its stream url', async () => {
  const pres = await seedLiveDeck({
    liveVideo: {
      enabled: false,
      streamUrl: 'https://www.youtube.com/watch?v=private',
    },
  });
  const { body } = await followPresentation(pres.id);
  assert.equal(body.presentation.liveVideo, null);
});
