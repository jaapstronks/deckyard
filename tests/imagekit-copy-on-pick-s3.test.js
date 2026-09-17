/**
 * B327 / D162 — the ImageKit copy is provider-agnostic.
 *
 * The companion file (`imagekit-copy-on-pick.test.js`) drives the local
 * provider end to end. The promise the feature makes is stronger than that: a
 * picked DAM asset becomes *this installation's* media, whichever provider is
 * configured — so on a bucket install the slide gets a bucket URL, not an
 * ImageKit one. CIIIC runs on S3, which is exactly the install the brief is
 * about, so leaving that untested would leave the deployment that motivated
 * the work uncovered.
 *
 * The provider singleton is chosen once per process (`initializeMediaProvider`
 * warns and keeps the first), which is why this is a separate file rather than
 * another case next door. The S3 client is real up to `send()`: the AWS SDK is
 * loaded and the command is built, only the network hop is intercepted — so a
 * change in how the bytes are handed to the bucket still shows up here.
 *
 * Run with: node --test tests/imagekit-copy-on-pick-s3.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.DEMO_MODE;
delete process.env.SANDBOX_MODE;
delete process.env.IMAGEKIT_ONLY;
delete process.env.UPLOADS_ENABLED;

process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
process.env.IMAGEKIT_PUBLIC_KEY = 'public_test';
process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/test';

// A complete S3 configuration, so the factory picks the bucket provider.
process.env.MEDIA_STORAGE_MODE = 's3';
process.env.S3_ACCESS_KEY = 'ak-test';
process.env.S3_SECRET_KEY = 'sk-test';
process.env.S3_BUCKET = 'decks-test';
process.env.S3_REGION = 'nl-ams';
process.env.S3_ENDPOINT = 'https://s3.nl-ams.example.com';
process.env.S3_PUBLIC_URL = 'https://cdn.example.test';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleMedia } = await import('../server/routes/api/media.js');
const { initializeMediaProvider, getMediaProvider } =
  await import('../server/media/index.js');

const USER = { email: 'olive@example.com', name: 'Olive', organizationId: ORG };
const FILE_ID = 'ik-file-1';
const CANONICAL_URL = 'https://ik.imagekit.io/test/team/olive.jpg';
const DETAILS_URL = `https://api.imagekit.io/v1/files/${FILE_ID}/details`;

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAQDN9pR4AAAAAElFTkSuQmCC',
  'base64',
);

const savedFetch = globalThis.fetch;
/** @type {Array<{Bucket: string, Key: string, Body: Buffer, ContentType: string}>} */
let putCommands = [];

test.before(async () => {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
  await initializeMediaProvider(process.cwd());

  const provider = getMediaProvider();
  assert.equal(
    provider.getStatus().name,
    's3',
    'this file is meaningless unless the bucket provider is the active one',
  );
  // Build the real client (and load the SDK, which `uploadBuffer` needs for
  // PutObjectCommand), then intercept only the network hop.
  await provider._getClient();
  provider._client.send = async (command) => {
    putCommands.push(command.input);
    return {};
  };
});

test.beforeEach(() => {
  putCommands = [];
  globalThis.fetch = async (rawUrl) => {
    const u = String(rawUrl);
    if (u.startsWith(DETAILS_URL)) {
      const details = { url: CANONICAL_URL, name: 'olive.jpg' };
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify(details),
        json: async () => details,
      };
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'image/png' : null),
      },
      arrayBuffer: async () => PNG_BYTES.buffer.slice(0, PNG_BYTES.length),
    };
  };
});

test.after(() => {
  globalThis.fetch = savedFetch;
  __resetStorageForTests();
  __setTestDb(null);
  for (const k of [
    'MEDIA_STORAGE_MODE',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET',
    'S3_REGION',
    'S3_ENDPOINT',
    'S3_PUBLIC_URL',
  ]) {
    delete process.env[k];
  }
});

function makeRes() {
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
      this.body = payload ? JSON.parse(payload) : null;
      return this;
    },
  };
}

async function importImage(body, { as = null } = {}) {
  const payload = JSON.stringify(body);
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const authedUser = as || undefined;
  await handleMedia({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL('http://decks.example.test/api/media/imagekit/import'),
    authedUser,
  });
  return res;
}

test('on a bucket install the copy lands in the bucket and the slide gets its URL', async () => {
  const res = await importImage({ fileId: FILE_ID }, { as: USER });

  assert.equal(res.statusCode, 201);
  assert.ok(
    res.body.url.startsWith('https://cdn.example.test/uploads/'),
    `expected a bucket/CDN URL, got ${res.body.url}`,
  );
  assert.ok(
    !res.body.url.includes('imagekit.io'),
    'the slide must not keep pointing at the DAM',
  );
  assert.equal(res.body.sourceUrl, CANONICAL_URL);

  assert.equal(putCommands.length, 1, 'exactly one object was written');
  const put = putCommands[0];
  assert.equal(put.Bucket, 'decks-test');
  assert.match(put.Key, /^uploads\/\d{4}\/\d{2}\/olive-/);
  assert.equal(put.ContentType, 'image/png');
  assert.ok(put.Body.length > 0, 'the bytes themselves went to the bucket');
});

test('a bucket write that fails refuses instead of falling back to the DAM URL', async () => {
  const provider = getMediaProvider();
  const good = provider._client.send;
  provider._client.send = async () => {
    throw new Error('bucket unreachable');
  };
  try {
    const res = await importImage({ fileId: FILE_ID }, { as: USER });
    assert.ok(
      res.statusCode >= 400,
      `expected a refusal, got ${res.statusCode}`,
    );
    assert.equal(
      res.body.url,
      undefined,
      'no URL at all on failure — the editor leaves the slide untouched',
    );
  } finally {
    provider._client.send = good;
  }
});
