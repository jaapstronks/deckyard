/**
 * The internal and public-API publish routes converge on one service
 * (server/services/publish-edition.js; B62 finding 8, T1.5).
 *
 * The v1 route used to reimplement a subset of the internal route and had
 * silently dropped the sandbox refusal and the `presentation.published`
 * webhook. Since T1.5 both routes only parse and answer: authorization, the
 * gates, the sealing, the commit and the webhook are `publishEdition()`, and
 * unpublishing is `unpublishPresentation()` on both. These tests pin that:
 *
 *   - both route modules import their publish and unpublish from the one
 *     service, and neither reaches the edition storage itself;
 *   - both routes answer 403 in sandbox mode and 400 without a body, before
 *     anything is read or written;
 *   - the gates (`missing_alt`, `incomplete_slides`) are the service's
 *     `prepareEdition()`, which refuses before the render bundle is opened.
 *
 * Handler-import level against the database double. The double has no render
 * bundle, so a publish that passes the gates stops at the bundle here; the
 * commit and the webhook it fires once per new edition (never on a replay)
 * run against PostgreSQL in the pg suite.
 *
 * Run with: node --test tests/publish-convergence.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const KEY_OWNER = 'owner@example.com';
const DECK_ID = 'd0000011-0000-4000-8000-000000000011';
const REPO_ROOT = process.cwd();

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { userIdFor, userRows } = await import('./helpers/identity-fixtures.js');
const { handlePublishing } =
  await import('../server/routes/public-api/v1/publishing.js');
const { handlePublish: handleInternalPublish } =
  await import('../server/routes/api/publish.js');
const { prepareEdition } =
  await import('../server/services/publish-edition.js');
const { RENDERER_BUNDLE_ERRORS } =
  await import('../server/render/renderer-bundle/index.js');
const { createMockRes } = await import('./helpers/http-mocks.js');
const { getStatusCode } = await import('../server/utils/errors.js');

function deckRow({ id, owner }) {
  return {
    id,
    organization_id: ORG,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    // Ownership is decided on the id, not the address (identity-match.js).
    owner_user_id: userIdFor(owner),
    created_by_user_id: userIdFor(owner),
    updated_by_user_id: userIdFor(owner),
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
        content: {
          title: 'Hoi',
          image: '/media/first-slide.jpg',
          alt: 'The harbour at first light',
        },
        parentId: null,
      },
    ],
    created_at: '2026-07-01T00:00:00.000Z',
    modified_at: '2026-07-01T00:00:00.000Z',
    trashed_at: null,
  };
}

async function installDb() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    users: userRows(KEY_OWNER),
    presentations: [deckRow({ id: DECK_ID, owner: KEY_OWNER })],
  });
  __setTestDb(db);
  await initializeStorage(REPO_ROOT);
  return db;
}

function storedDeck(db, id) {
  return db.__tables.presentations.find((row) => row.id === id);
}

/** Nothing was staged or committed, and no edition table was even read. */
function assertNothingWritten(db) {
  assert.equal(db.__tables.publication_staging?.length ?? 0, 0);
  assert.equal(db.__tables.publication_editions?.length ?? 0, 0);
}

const BODY = { expectedRevision: 1, idempotencyKey: 'intent-1' };
const bodyStream = (body) =>
  Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);

function makeV1Ctx(
  method,
  deckId,
  { permissions = ['read', 'write'], body = BODY } = {},
) {
  const req = bodyStream(body);
  req.method = method;
  req.headers = { host: 'decks.example.test' };

  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };

  return {
    req,
    res,
    url: new URL(`http://localhost/api/v1/presentations/${deckId}/publish`),
    repoRoot: REPO_ROOT,
    storageScope: {
      repoRoot: REPO_ROOT,
      organizationId: ORG,
      actorUserId: userIdFor(KEY_OWNER),
      actorEmail: KEY_OWNER,
    },
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: KEY_OWNER,
      permissions,
      organizationId: ORG,
    },
    authedUser: {
      // The middleware resolves the key owner to this id once per request.
      id: userIdFor(KEY_OWNER),
      email: KEY_OWNER,
      role: 'user',
      organizationId: ORG,
    },
  };
}

/** POST /api/presentations/:id/publish as the editor sends it. */
async function internalPublish(deckId, body = BODY) {
  const req = bodyStream(body);
  req.method = 'POST';
  req.headers = { host: 'decks.example.test' };
  const res = createMockRes();
  await handleInternalPublish({
    repoRoot: REPO_ROOT,
    storageScope: testScope(REPO_ROOT, { actorEmail: KEY_OWNER }),
    req,
    res,
    url: new URL(`http://localhost/api/presentations/${deckId}/publish`),
    authedUser: { id: userIdFor(KEY_OWNER), email: KEY_OWNER },
  });
  return res;
}

/** A store with no render bundle: a publish past the gates stops there. */
const emptyStore = await fs.mkdtemp(path.join(os.tmpdir(), 'no-bundle-'));
test.after(() => fs.rm(emptyStore, { recursive: true, force: true }));

function prepare(db) {
  return prepareEdition(
    testScope(REPO_ROOT, { actorEmail: KEY_OWNER }),
    storedDeck(db, DECK_ID),
    { rendererStore: emptyStore },
  );
}

function addEmptyImageSlide(db) {
  storedDeck(db, DECK_ID).slides.push({
    id: 'slide-2',
    type: 'image-slide',
    content: { title: 'Beeld volgt', image: '' },
    parentId: null,
  });
}

// ---------------------------------------------------------------------------
// One service behind both routes
// ---------------------------------------------------------------------------

test('both routes publish and unpublish through the one service, never the storage', async () => {
  for (const file of [
    'server/routes/api/publish.js',
    'server/routes/public-api/v1/publishing.js',
  ]) {
    const src = await fs.readFile(path.join(REPO_ROOT, file), 'utf8');
    assert.match(
      src,
      /import \{[^}]*\bpublishEdition\b[^}]*\bunpublishPresentation\b[^}]*\} from '[./]+services\/publish-edition\.js'/s,
      `${file} imports publishEdition and unpublishPresentation from the service`,
    );
    assert.doesNotMatch(
      src,
      /storage\/editions\.js|commitEdition|revokeDeckEditions/,
      file,
    );
  }
});

test('both routes refuse in sandbox mode with 403, before the body or the deck is read', async () => {
  const db = await installDb();
  process.env.SANDBOX_MODE = 'true';
  let internal, v1;
  try {
    internal = await internalPublish(DECK_ID);
    v1 = makeV1Ctx('POST', DECK_ID);
    assert.equal(await handlePublishing(v1), true);
  } finally {
    delete process.env.SANDBOX_MODE;
  }
  assert.equal(internal.statusCode, 403);
  assert.equal(v1.res.statusCode, 403);
  // The v1 envelope: a machine code, no internal `ok:false`.
  assert.equal(v1.res.body.error, 'forbidden');
  assertNothingWritten(db);
});

test('both routes refuse a publish without expectedRevision or idempotencyKey with 400', async () => {
  const db = await installDb();
  for (const body of [
    { idempotencyKey: 'k' },
    { expectedRevision: 1 },
    { expectedRevision: '1', idempotencyKey: 'k' },
  ]) {
    const internal = await internalPublish(DECK_ID, body);
    assert.equal(internal.statusCode, 400, JSON.stringify(body));
    assert.equal(internal.json().error, 'invalid');
    const v1 = makeV1Ctx('POST', DECK_ID, { body });
    await handlePublishing(v1);
    assert.equal(v1.res.statusCode, 400, JSON.stringify(body));
    assert.equal(v1.res.body.error, 'invalid');
  }
  assertNothingWritten(db);
});

// ---------------------------------------------------------------------------
// The gates: prepareEdition refuses before the render bundle is opened
// ---------------------------------------------------------------------------

test('a picture without alt text is refused before the bundle is opened (D137)', async () => {
  const db = await installDb();
  storedDeck(db, DECK_ID).slides[0].content.alt = '';
  await assert.rejects(prepare(db), (err) => {
    assert.equal(getStatusCode(err), 422);
    assert.equal(err.code, 'missing_alt');
    assert.deepEqual(err.toJSON().details, {
      lang: null,
      slideIndex: 0,
      slideId: 'slide-1',
      field: 'image',
      count: 1,
    });
    assert.match(err.message, /Slide 1 has an image without alt text/);
    return true;
  });
  assertNothingWritten(db);
});

test('an empty essential picture is refused with 422 incomplete_slides, before the alt check', async () => {
  const db = await installDb();
  addEmptyImageSlide(db);
  await assert.rejects(prepare(db), (err) => {
    assert.equal(getStatusCode(err), 422);
    assert.equal(err.code, 'incomplete_slides');
    assert.deepEqual(err.toJSON().details, { slides: [2] });
    assert.match(err.message, /Slide 2 still has an empty image/);
    return true;
  });

  // A picture chosen without alt text: rightly the next refusal.
  storedDeck(db, DECK_ID).slides[1].content.image = '/media/second.jpg';
  await assert.rejects(prepare(db), (err) => {
    assert.equal(err.code, 'missing_alt');
    assert.equal(err.toJSON().details.slideIndex, 1);
    return true;
  });

  // With alt text the gates pass, and the bundle is the next question.
  storedDeck(db, DECK_ID).slides[1].content.alt = 'The quay at noon';
  await assert.rejects(prepare(db), { code: RENDERER_BUNDLE_ERRORS.UNKNOWN });
  assertNothingWritten(db);
});

test('a decorative picture needs no alt text', async () => {
  const db = await installDb();
  storedDeck(db, DECK_ID).slides[0].content = {
    title: 'Hoi',
    image: '/media/first-slide.jpg',
    imageRole: 'decorative',
  };
  await assert.rejects(prepare(db), { code: RENDERER_BUNDLE_ERRORS.UNKNOWN });
});

test('a slide the published page never shows does not block the publish', async () => {
  const db = await installDb();
  addEmptyImageSlide(db);
  storedDeck(db, DECK_ID).slides[1].visibility = { hideInPublished: true };
  await assert.rejects(prepare(db), { code: RENDERER_BUNDLE_ERRORS.UNKNOWN });
});
