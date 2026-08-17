/**
 * B62 vondst 8 — the internal and public-API publish routes converge on one
 * shared core (server/services/publish-presentation.js).
 *
 * Before B62 the v1 route (`POST /api/v1/presentations/:id/publish`)
 * reimplemented a subset of the internal route and had silently dropped two
 * behaviours: the sandbox refusal (a guest could mint an API key and publish
 * onto the public domain) and the `presentation.published` webhook. These
 * tests pin the converged behaviour on both the core and the v1 route:
 *
 *   - the core throws a 403 ForbiddenError in sandbox mode, and writes the
 *     entry / deck column / descriptor on the happy path;
 *   - the v1 route answers 403 in sandbox mode without publishing; and
 *   - a publish through the v1 route fires the presentation.published webhook.
 *
 * Handler-import level against the database double, like the neighbours
 * (tests/public-api-v1-publishing.test.js). The media provider is not
 * initialized under test, so the OG image takes the documented fallback ladder.
 *
 * Run with: node --test tests/publish-convergence.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const KEY_OWNER = 'owner@example.com';
const DECK_ID = 'deck-to-publish';
const REPO_ROOT = process.cwd();
// A public-IP URL so the SSRF guard passes without a DNS lookup (matching
// tests/webhook-payload-contracts.test.js).
const WEBHOOK_URL = 'http://203.0.114.9/published';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/storage/adapters/index.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { writeAppSettings } = await import('../server/storage/settings.js');
const { handlePublishing } = await import('../server/routes/public-api/v1/publishing.js');
const { publishPresentation } = await import('../server/services/publish-presentation.js');
const { isAppError, getStatusCode } = await import('../server/utils/errors.js');

function deckRow({ id, owner }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    title: `Title of ${id}`,
    description: null,
    theme: 'default',
    lang: 'nl',
    visibility: 'private',
    revision: 1,
    settings: {},
    i18n: null,
    slides: [
      {
        id: 'slide-1',
        type: 'image-slide',
        content: { title: 'Hoi', image: '/media/first-slide.jpg' },
        parentId: null,
      },
    ],
    published: null,
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-07-01T00:00:00.000Z',
    trashed_at: null,
  };
}

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    presentations: [deckRow({ id: DECK_ID, owner: KEY_OWNER })],
    published_presentations: [],
  });
  __setTestDb(db);
  await initializeStorage(REPO_ROOT);
  return db;
}

function storedDeck(db, id) {
  return db.__tables.presentations.find((row) => row.id === id);
}

function makeV1Ctx(method, deckId, { permissions = ['read', 'write'] } = {}) {
  const req = Readable.from([]);
  req.method = method;
  req.headers = { host: 'decks.example.test' };

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(payload) { this.body = payload ? JSON.parse(payload) : null; },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost/api/v1/presentations/${deckId}/publish`),
    repoRoot: REPO_ROOT,
    storageScope: { repoRoot: REPO_ROOT, organizationId: ORG, actorEmail: KEY_OWNER },
    apiKey: { id: 'key-1', tier: 'free', ownerEmail: KEY_OWNER, permissions, organizationId: ORG },
    authedUser: { id: null, email: KEY_OWNER, role: 'user', organizationId: ORG },
  };
}

/** The webhook fire path is `void postJson(...)`; give its microtasks room. */
async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

// ---------------------------------------------------------------------------
// The shared core
// ---------------------------------------------------------------------------

test('core: publishPresentation refuses in sandbox mode with a 403', async () => {
  const db = await installDb();
  const pres = storedDeck(db, DECK_ID);
  process.env.SANDBOX_MODE = 'true';
  try {
    await assert.rejects(
      () => publishPresentation({
        repoRoot: REPO_ROOT,
        storageScope: testScope(REPO_ROOT, { actorEmail: KEY_OWNER }),
        req: { headers: {} },
        pres,
        actor: { email: KEY_OWNER },
      }),
      (err) => {
        assert.ok(isAppError(err), 'is an AppError');
        assert.equal(getStatusCode(err), 403);
        assert.equal(err.code, 'forbidden');
        return true;
      }
    );
  } finally {
    delete process.env.SANDBOX_MODE;
  }
  // No published row was written and the deck column is untouched.
  assert.equal(db.__tables.published_presentations.length, 0);
  assert.equal(storedDeck(db, DECK_ID).published, null);
});

test('core: publishPresentation writes the entry, the deck column, and the descriptor', async () => {
  const db = await installDb();
  const pres = storedDeck(db, DECK_ID);

  const result = await publishPresentation({
    repoRoot: REPO_ROOT,
    storageScope: testScope(REPO_ROOT, { actorEmail: KEY_OWNER }),
    req: { headers: {} },
    pres,
    actor: { email: KEY_OWNER },
  });

  assert.ok(result.publishId, 'a publish id is minted');
  assert.equal(result.slug, 'title-of-deck-to-publish');
  assert.equal(result.path, `/p/${result.publishId}-${result.slug}`);
  assert.equal(result.ogImageUrl, '/media/first-slide.jpg', 'fallback ladder: first slide image');

  const entry = db.__tables.published_presentations.find((r) => r.presentation_id === DECK_ID);
  assert.ok(entry, 'a publish entry row was written');
  assert.equal(entry.id, result.publishId);
  assert.equal(storedDeck(db, DECK_ID).published.id, result.publishId, 'deck carries the publish state');
});

// ---------------------------------------------------------------------------
// The v1 route, converged
// ---------------------------------------------------------------------------

test('v1: POST /publish is refused with 403 in sandbox mode and does not publish', async () => {
  const db = await installDb();
  const ctx = makeV1Ctx('POST', DECK_ID);
  process.env.SANDBOX_MODE = 'true';
  try {
    assert.equal(await handlePublishing(ctx), true);
  } finally {
    delete process.env.SANDBOX_MODE;
  }
  assert.equal(ctx.res.statusCode, 403);
  // The v1 envelope: a machine code, no internal `ok:false`.
  assert.equal(ctx.res.body.error, 'forbidden');
  assert.equal(storedDeck(db, DECK_ID).published, null, 'the deck stays unpublished');
  assert.equal(db.__tables.published_presentations.length, 0);
});

test('v1: POST /publish fires the presentation.published webhook', async () => {
  const db = await installDb();
  await writeAppSettings(testScope(REPO_ROOT), {
    webhooks: { presentationPublishedUrl: WEBHOOK_URL },
  });

  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return { ok: true, status: 200 };
  };

  try {
    const ctx = makeV1Ctx('POST', DECK_ID);
    assert.equal(await handlePublishing(ctx), true);
    assert.equal(ctx.res.statusCode, 200);
    await settle();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalls.length, 1, 'exactly one webhook delivery');
  const call = fetchCalls[0];
  assert.equal(call.url, WEBHOOK_URL);
  assert.equal(call.options.headers['x-sb-event'], 'presentation.published');
  const payload = JSON.parse(call.options.body);
  assert.equal(payload.event, 'presentation.published');
  assert.equal(payload.presentation.id, DECK_ID);
  assert.equal(payload.actor.email, KEY_OWNER);

  // Sanity: the deck is actually published too.
  assert.ok(storedDeck(db, DECK_ID).published?.id);
});
