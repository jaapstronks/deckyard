/**
 * Generated OG previews leave a remote origin when they stop belonging to the
 * publication (B806): when a publish or regenerate replaces the image, on
 * unpublish, and lazily at the three public seams (`/p/`, the feed, the v1
 * publish status) once the proof behind the image expires. Only a name the OG
 * generator minted is ever touched, and only on the configured bucket.
 *
 * The media provider is the real S3Provider with its AWS client replaced by a
 * recorder; no bucket is involved. The local provider has its own proof
 * (tests/local-preview-withdrawal.test.js), the sweep too
 * (tests/sweep-published-previews.test.js).
 *
 * Run with: node --test tests/remote-preview-withdrawal.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';
process.env.STORAGE_MODE = 'postgres';
delete process.env.SANDBOX_MODE;
delete process.env.MULTI_ORG_ENABLED;
delete process.env.MEDIA_STORAGE_MODE;
Object.assign(process.env, {
  S3_ACCESS_KEY: 'ak-test',
  S3_SECRET_KEY: 'sk-test',
  S3_BUCKET: 'media',
  S3_REGION: 'nl-ams',
  S3_ENDPOINT: 'https://s3.nl-ams.example.com',
  S3_PUBLIC_URL: 'https://cdn.example.com',
});

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OWNER = 'owner@example.com';
const DECK_ID = 'd0000806-0000-4000-8000-000000000806';
const PUBLISH_ID = 'abcd1234';
const REPO_ROOT = process.cwd();
const CDN = 'https://cdn.example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { userIdFor, userRows } = await import('./helpers/identity-fixtures.js');
const { brandSeedRow } = await import('./helpers/theme-seed.js');
const { createMockStreamRes } = await import('./helpers/http-mocks.js');
const { initializeMediaProvider, getMediaProvider } =
  await import('../server/media/index.js');
const { getPresentation } =
  await import('../server/storage/presentations/index.js');
const { publishedPreviewFingerprint } =
  await import('../server/render/og-image.js');
const { getOgImageUrl } = await import('../server/config/branding.js');
const { publishPresentation, unpublishPresentation, withdrawPublishedPreview } =
  await import('../server/services/publish-presentation.js');
const { handlePublished } =
  await import('../server/routes/static/published.js');
const { handleFeed } = await import('../server/routes/feed.js');
const { handlePublishing } =
  await import('../server/routes/public-api/v1/publishing.js');
const { handlePublish } = await import('../server/routes/api/publish.js');

await initializeMediaProvider(REPO_ROOT);
const provider = getMediaProvider();
assert.equal(provider.getStatus().name, 's3');
await provider._getClient(); // load the SDK command classes

/** Every command the bucket received, and a switch that makes deletes fail. */
const bucket = { sent: [], failDeletes: false };
provider._client = {
  async send(cmd) {
    bucket.sent.push({ name: cmd.constructor.name, input: cmd.input });
    if (bucket.failDeletes && cmd.constructor.name === 'DeleteObjectCommand') {
      throw new Error('bucket unavailable');
    }
    return {};
  },
};
const deletedKeys = () =>
  bucket.sent
    .filter((c) => c.name === 'DeleteObjectCommand')
    .map((c) => c.input.Key);

const generatedName = (n) =>
  `og-v2-${PUBLISH_ID}-0123456789abcdef0123-00000000-0000-4000-8000-00000000000${n}.png`;
const OLD_KEY = `uploads/2026/10/${generatedName(1)}`;
const OLD_URL = `${CDN}/${OLD_KEY}`;

function deckRow(slides) {
  return {
    id: DECK_ID,
    organization_id: ORG,
    owner_email: OWNER,
    created_by: OWNER,
    updated_by: OWNER,
    owner_user_id: userIdFor(OWNER),
    created_by_user_id: userIdFor(OWNER),
    updated_by_user_id: userIdFor(OWNER),
    title: 'Harbour',
    description: null,
    theme: 'default',
    lang: 'en',
    visibility: 'private',
    revision: 7,
    settings: {},
    i18n: null,
    slides,
    published: null,
    created_at: '2026-10-01T00:00:00.000Z',
    modified_at: '2026-10-01T00:00:00.000Z',
    trashed_at: null,
  };
}

const OPENING = {
  id: 'slide-1',
  type: 'title-slide',
  content: { title: 'Opening', subtitle: '' },
};

/**
 * A deck published with `OLD_URL` as its preview. `proven` stamps the
 * fingerprint of the deck as it is stored, so the preview is still safe;
 * otherwise the fingerprint is stale, as after hiding the opening slide.
 * `themed: false` leaves the default theme out.
 */
async function installPublished({ proven, slides = [OPENING], themed = true }) {
  const db = createFakeDb({
    organizations: [
      {
        id: ORG,
        name: 'Default',
        slug: 'default',
        settings: { rss: { enabled: true } },
      },
    ],
    users: userRows(OWNER),
    presentations: [deckRow(slides)],
    published_presentations: [
      {
        id: PUBLISH_ID,
        organization_id: ORG,
        presentation_id: DECK_ID,
        title: 'Harbour',
        slug: 'harbour',
        og_image_url: OLD_URL,
        created_at: '2026-10-01T00:00:00.000Z',
        modified_at: '2026-10-01T00:00:00.000Z',
      },
    ],
    app_settings: [{ id: 'singleton', settings: {} }],
    // The public pages need the default theme; without it a render fails
    // fast and the regenerate route takes the fallback, so no browser starts.
    themes: themed ? [await brandSeedRow()] : [],
  });
  __setTestDb(db);
  await initializeStorage(REPO_ROOT);
  const loaded = await getPresentation(testScope(REPO_ROOT), DECK_ID);
  db.__tables.presentations[0].published = {
    id: PUBLISH_ID,
    slug: 'harbour',
    ogImageUrl: OLD_URL,
    previewFingerprint: proven ? publishedPreviewFingerprint(loaded) : 'stale',
  };
  bucket.sent.length = 0;
  bucket.failDeletes = false;
  return db;
}

const storedDeck = (db) => db.__tables.presentations[0];
const storedEntry = (db) => db.__tables.published_presentations[0];
const deckOgUrl = (db) => {
  const published = storedDeck(db).published;
  return (typeof published === 'string' ? JSON.parse(published) : published)
    ?.ogImageUrl;
};

const owner = {
  id: userIdFor(OWNER),
  email: OWNER,
  role: 'user',
  organizationId: ORG,
};
const ownerScope = () =>
  testScope(REPO_ROOT, { actorEmail: OWNER, actorUserId: userIdFor(OWNER) });

async function getPage() {
  const url = new URL(`http://example.test/p/${PUBLISH_ID}-harbour`);
  const res = createMockStreamRes();
  await handlePublished({
    repoRoot: REPO_ROOT,
    req: { method: 'GET', headers: { host: 'example.test' } },
    res,
    url,
    pathname: url.pathname,
  });
  return { status: res.statusCode, body: res.body.toString('utf8') };
}

async function getFeed() {
  const res = createMockStreamRes();
  await handleFeed({
    repoRoot: REPO_ROOT,
    req: { method: 'GET', headers: { host: 'example.test' } },
    res,
    url: new URL('http://example.test/feed/rss.xml'),
  });
  return { status: res.statusCode, body: res.body.toString('utf8') };
}

async function getV1Status() {
  const req = Readable.from([]);
  req.method = 'GET';
  req.headers = { host: 'example.test' };
  const res = createMockStreamRes();
  await handlePublishing({
    req,
    res,
    url: new URL(`http://localhost/api/v1/presentations/${DECK_ID}/publish`),
    repoRoot: REPO_ROOT,
    storageScope: ownerScope(),
    apiKey: {
      id: 'key-1',
      tier: 'free',
      ownerEmail: OWNER,
      permissions: ['read', 'write'],
      organizationId: ORG,
    },
    authedUser: owner,
  });
  return res.json();
}

// ---------------------------------------------------------------------------
// The one withdrawal
// ---------------------------------------------------------------------------

test('a generated preview on the bucket is deleted by its key, under every address of the bucket', async () => {
  bucket.sent.length = 0;
  assert.equal(await withdrawPublishedPreview(OLD_URL), 'deleted');
  assert.equal(
    await withdrawPublishedPreview(
      `https://media.s3.nl-ams.example.com/${OLD_KEY}`,
    ),
    'deleted',
  );
  assert.equal(
    await withdrawPublishedPreview(
      `https://s3.nl-ams.example.com/media/${OLD_KEY}?v=2`,
    ),
    'deleted',
  );
  assert.deepEqual(deletedKeys(), [OLD_KEY, OLD_KEY, OLD_KEY]);
});

test('an ordinary upload, a foreign host or a local path is never touched', async () => {
  bucket.sent.length = 0;
  for (const url of [
    `${CDN}/uploads/2026/10/photo-00000000-0000-4000-8000-000000000001.png`,
    `${CDN}/uploads/2026/10/og-photo-of-me.png`,
    `https://elsewhere.example.org/uploads/2026/10/${generatedName(1)}`,
    `/uploads/${generatedName(1)}`,
    '',
    null,
  ]) {
    assert.equal(await withdrawPublishedPreview(url), 'kept', String(url));
  }
  assert.deepEqual(bucket.sent, []);
});

test('a delete the bucket refuses is reported as failed, not as done', async () => {
  bucket.sent.length = 0;
  bucket.failDeletes = true;
  try {
    assert.equal(await withdrawPublishedPreview(OLD_URL), 'failed');
  } finally {
    bucket.failDeletes = false;
  }
});

// ---------------------------------------------------------------------------
// Replace and unpublish
// ---------------------------------------------------------------------------

test('publishing again withdraws the preview it replaced', async () => {
  // Only a live-only slide: nothing to render, so the new card is the default.
  const db = await installPublished({
    proven: true,
    slides: [{ id: 'live', type: 'follow-invite-slide', content: {} }],
  });
  const pres = await getPresentation(ownerScope(), DECK_ID);
  const result = await publishPresentation({
    repoRoot: REPO_ROOT,
    storageScope: ownerScope(),
    req: { headers: {} },
    pres,
    actor: { email: OWNER },
  });
  assert.equal(result.publishId, PUBLISH_ID);
  assert.notEqual(result.ogImageUrl, OLD_URL);
  assert.deepEqual(deletedKeys(), [OLD_KEY]);
  assert.equal(storedEntry(db).og_image_url, result.ogImageUrl);
});

test('regenerating the preview withdraws the replaced one', async () => {
  await installPublished({ proven: true, themed: false });
  const res = createMockStreamRes();
  await handlePublish({
    repoRoot: REPO_ROOT,
    storageScope: ownerScope(),
    req: { method: 'POST', headers: {} },
    res,
    url: new URL(
      `http://localhost/api/presentations/${DECK_ID}/preview/regenerate`,
    ),
    pathname: `/api/presentations/${DECK_ID}/preview/regenerate`,
    method: 'POST',
    authedUser: owner,
  });
  assert.equal(res.statusCode, 200, String(res.body));
  const { ogImageUrl } = res.json();
  assert.notEqual(ogImageUrl, OLD_URL);
  assert.ok(deletedKeys().includes(OLD_KEY), 'the replaced preview is gone');
});

test('unpublishing withdraws the preview the link advertised', async () => {
  const db = await installPublished({ proven: true });
  await unpublishPresentation(ownerScope(), { actor: owner }, DECK_ID);
  assert.equal(db.__tables.published_presentations.length, 0);
  assert.deepEqual(deletedKeys(), [OLD_KEY]);
});

// ---------------------------------------------------------------------------
// Lazily at the public seams
// ---------------------------------------------------------------------------

for (const [seam, read, advertised] of [
  ['/p/', getPage, (res) => res.body],
  ['the feed', getFeed, (res) => res.body],
  ['v1 publish status', getV1Status, (body) => body.ogImageUrl],
]) {
  test(`${seam}: expired proof withdraws the preview and blanks the stored URLs once`, async () => {
    const db = await installPublished({ proven: false });
    const first = advertised(await read());
    assert.ok(
      !first.includes(OLD_KEY),
      'the expired preview is not advertised',
    );
    assert.ok(first.includes(getOgImageUrl()), 'the generic card is');
    assert.deepEqual(deletedKeys(), [OLD_KEY]);
    assert.equal(storedEntry(db).og_image_url, '');
    assert.equal(deckOgUrl(db), '');
    assert.equal(storedDeck(db).revision, 7, 'not an edit of the deck');
    assert.equal(
      storedDeck(db).modified_at,
      '2026-10-01T00:00:00.000Z',
      'the deck is not re-dated',
    );
    assert.equal(
      String(storedEntry(db).modified_at),
      '2026-10-01T00:00:00.000Z',
      'the entry is not re-dated',
    );

    bucket.sent.length = 0;
    await read();
    assert.deepEqual(bucket.sent, [], 'the next read decides nothing again');
  });

  test(`${seam}: a proven preview stays advertised and on the bucket`, async () => {
    const db = await installPublished({ proven: true });
    assert.ok(advertised(await read()).includes(OLD_KEY));
    assert.deepEqual(bucket.sent, []);
    assert.equal(storedEntry(db).og_image_url, OLD_URL);
  });
}

test('a failed withdrawal keeps the stored URL, so the next read retries', async () => {
  const db = await installPublished({ proven: false });
  bucket.failDeletes = true;
  const res = await getPage();
  assert.equal(res.status, 200, 'the page does not fail over its preview');
  assert.ok(!res.body.includes(OLD_KEY));
  assert.equal(storedEntry(db).og_image_url, OLD_URL);
  assert.equal(deckOgUrl(db), OLD_URL);

  bucket.failDeletes = false;
  bucket.sent.length = 0;
  await getPage();
  assert.deepEqual(deletedKeys(), [OLD_KEY]);
  assert.equal(storedEntry(db).og_image_url, '');
});
