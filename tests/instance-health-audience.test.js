/**
 * The instance-health measuring points on the audience's side (B514, D247):
 * the four viewing handlers count `surface` and `slide_type.viewed`, and the
 * live-interaction facades count `interaction`.
 *
 * Handler- and facade-level over the database double, in the house shape of
 * `tests/published-embed-first-party-only.test.js` and
 * `tests/anon-follow-and-share-surfaces.test.js`. The counts land
 * fire-and-forget, so each assertion reads through `healthKeys`.
 *
 * Run with: node --test tests/instance-health-audience.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { testScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';
import { brandSeedRow } from './helpers/theme-seed.js';
import { healthKeys } from './helpers/instance-health.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const REPO_ROOT = process.cwd();
const CLIENT_DIR = path.join(process.cwd(), 'client');
const PUBLISH_ID = 'abcd1234';
const SLUG = 'my-deck';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createPresentation } =
  await import('../server/storage/presentations/index.js');
const { createLiveSession, updateLiveSessionState } =
  await import('../server/storage/live-sessions/index.js');
const { createShareLink } =
  await import('../server/storage/share-links/index.js');
const { createFollowCode, resolveFollowCode } =
  await import('../server/storage/follow-codes.js');
const { votePollInteraction } =
  await import('../server/storage/interactions.js');
const { createQuestion } = await import('../server/storage/questions.js');
const { handlePublished } =
  await import('../server/routes/static/published.js');
const { handleEmbed } = await import('../server/routes/static/embed.js');
const { handleShareLink } =
  await import('../server/routes/static/share-viewer.js');
const { handleFollowPresentation } =
  await import('../server/routes/api/follow/presentation.js');

let brandSeed;
let db;

test.before(async () => {
  brandSeed = await brandSeedRow();
});

test.beforeEach(async () => {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    themes: [brandSeed],
    users: userRows(OWNER),
    app_settings: [{ id: 'singleton', settings: {} }],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.afterEach(() => {
  __resetStorageForTests();
  __setTestDb(null);
});

const SLIDES = [
  { type: 'title-slide', content: { title: 'A' } },
  { type: 'poll-slide', content: { question: 'Q', options: 'Yes\nNo' } },
];

/** A deck, with what its creation counted forgotten. */
async function seedDeck() {
  const pres = await createPresentation(testScope(REPO_ROOT), {
    title: 'Watched deck',
    ownerEmail: OWNER,
    theme: 'default',
    slides: SLIDES,
  });
  await healthKeys(db);
  db.__tables.instance_health = [];
  return pres;
}

function makeRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      if (this.statusCode === null) this.statusCode = 200;
      this.body = payload ?? null;
      return this;
    },
  };
}

function viewerContext(pathname) {
  return {
    repoRoot: REPO_ROOT,
    req: { method: 'GET', headers: { host: 'decks.example.test' }, socket: {} },
    res: makeRes(),
    url: new URL(`http://decks.example.test${pathname}`),
    clientDir: CLIENT_DIR,
  };
}

const VIEWED = [
  'slide_type.viewed:poll-slide',
  'slide_type.viewed:title-slide',
];

async function publish(pres) {
  db.__tables.published_presentations = [
    {
      id: PUBLISH_ID,
      organization_id: ORG,
      presentation_id: pres.id,
      title: pres.title,
      slug: SLUG,
      og_image_url: null,
      created_at: '2026-02-01T00:00:00.000Z',
      modified_at: '2026-02-01T00:00:00.000Z',
    },
  ];
}

for (const [label, handle, pathname] of [
  ['the published page', handlePublished, `/p/${PUBLISH_ID}-${SLUG}`],
  ['the published reader', handlePublished, `/p/${PUBLISH_ID}-${SLUG}/reader`],
]) {
  test(`${label} counts surface:published and the deck's types`, async () => {
    await publish(await seedDeck());
    const c = viewerContext(pathname);
    assert.equal(await handle(c), true);
    assert.equal(c.res.statusCode, 200);
    assert.deepEqual(await healthKeys(db), [...VIEWED, 'surface:published']);
  });
}

test('a slug redirect is not a view; the page it lands on is', async () => {
  await publish(await seedDeck());
  const c = viewerContext(`/p/${PUBLISH_ID}-wrong-slug`);
  await handlePublished(c);
  assert.equal(c.res.statusCode, 302);
  assert.deepEqual(await healthKeys(db), []);
});

test('an embed counts surface:embed and the deck types', async () => {
  await publish(await seedDeck());
  const c = viewerContext(`/embed/${PUBLISH_ID}-${SLUG}`);
  assert.equal(await handleEmbed(c), true);
  assert.equal(c.res.statusCode, 200);
  assert.deepEqual(await healthKeys(db), [...VIEWED, 'surface:embed']);
});

test('a share link counts surface:share and the deck types', async () => {
  const pres = await seedDeck();
  const link = await createShareLink(testScope(), pres.id, {
    permission: 'view',
  });
  const c = viewerContext(`/s/${link.shareLink.token}`);
  assert.equal(await handleShareLink(c), true);
  assert.deepEqual(await healthKeys(db), [...VIEWED, 'surface:share']);
});

test('an unknown share token counts nothing', async () => {
  const c = viewerContext('/s/not-a-token');
  await handleShareLink(c);
  assert.deepEqual(await healthKeys(db), []);
});

/** A deck with a live session parked on its first slide. */
async function seedLiveDeck() {
  const pres = await seedDeck();
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
  await healthKeys(db);
  db.__tables.instance_health = [];
  return { pres, sessionId: session.sessionId };
}

test('the follow audience counts surface:follow and the deck types', async () => {
  const { pres } = await seedLiveDeck();
  const c = viewerContext(`/api/follow/${pres.id}/presentation`);
  await handleFollowPresentation(c, pres.id);
  assert.equal(c.res.statusCode, 200);
  assert.deepEqual(await healthKeys(db), [...VIEWED, 'surface:follow']);
});

test('a deck that is not live is not a follow view', async () => {
  const pres = await seedDeck();
  const c = viewerContext(`/api/follow/${pres.id}/presentation`);
  await handleFollowPresentation(c, pres.id);
  assert.deepEqual(await healthKeys(db), []);
});

test('starting a live session counts interaction:live_session', async () => {
  const pres = await seedDeck();
  await createLiveSession(
    { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: null },
    { presentationId: pres.id },
  );
  assert.deepEqual(await healthKeys(db), ['interaction:live_session']);
});

// Polls, likerts and feedback read their aggregate through SQL the double
// does not model (a `FILTER` count), so their counts are pinned against real
// PostgreSQL in tests/pg/instance-health.pgtest.js.

test('a refused vote counts nothing', async () => {
  const { sessionId } = await seedLiveDeck();
  const presenter = { repoRoot: REPO_ROOT, organizationId: ORG };
  const out = await votePollInteraction(presenter, sessionId, {
    slideId: 's-poll',
    optionCount: 2,
    deviceId: 'device-1',
    optionIndex: 7,
  });
  assert.equal(out.ok, false);
  assert.deepEqual(await healthKeys(db), []);
});

test('a question counts as interaction:question_created', async () => {
  const { sessionId } = await seedLiveDeck();
  const presenter = { repoRoot: REPO_ROOT, organizationId: ORG };
  const q = await createQuestion(presenter, sessionId, {
    authorId: 'a0000000-0000-4000-8000-000000000001',
    authorName: 'Anon',
    text: 'Why?',
  });
  assert.equal(q.ok, true);
  assert.deepEqual(await healthKeys(db), ['interaction:question_created']);
});

test('a follow code resolves as interaction:follow_code; minting one does not count', async () => {
  const presenter = { repoRoot: REPO_ROOT, organizationId: ORG };
  const code = await createFollowCode(presenter, '/follow/abc');
  assert.deepEqual(await healthKeys(db), []);
  assert.equal(await resolveFollowCode(presenter, code), '/follow/abc');
  assert.equal(await resolveFollowCode(presenter, 'NOPE00'), null);
  assert.deepEqual(await healthKeys(db), ['interaction:follow_code']);
});
