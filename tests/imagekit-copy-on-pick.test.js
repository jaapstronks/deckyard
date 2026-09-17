/**
 * B327 / D162 — an ImageKit pick becomes own media before it reaches a slide.
 *
 * `POST /api/media/imagekit/import` is the server half: it copies the bytes of
 * a DAM asset into whatever media provider this installation runs, so a deck
 * never depends on a live third-party URL. Three things make it safe, and all
 * three are pinned here:
 *
 *   1. **It is an upload.** Same gate ladder as every other write that stores
 *      bytes — signed in, uploads enabled (which `IMAGEKIT_ONLY` turns off),
 *      not demo/sandbox, a provider initialized — refused in that order, before
 *      a body is parsed. The refusal under `IMAGEKIT_ONLY` is the decided
 *      behaviour, not a gap: there is no own media to copy into, so the picker
 *      says so up front and the server says so to a direct request.
 *   2. **The caller does not choose the URL.** The `fileId` is resolved against
 *      the configured ImageKit account and only that file's own URL is fetched
 *      — optionally carrying the picker's `?tr=` transformation. Anything else
 *      is refused, which is what keeps this from being a generic URL proxy.
 *   3. **The fetch is SSRF-guarded**, through the same `safeFetchRemoteImage`
 *      the Notion re-host uses (they share `server/media/rehost.js` now).
 *
 * And the failure rule: a refusal answers an error, never a URL — the editor
 * leans on that to leave the slide untouched.
 *
 * The local provider is driven end to end here; the bucket provider has its own
 * file (`imagekit-copy-on-pick-s3.test.js`), because the provider singleton is
 * chosen once per process.
 *
 * Run with: node --test tests/imagekit-copy-on-pick.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.DEMO_MODE;
delete process.env.SANDBOX_MODE;
delete process.env.IMAGEKIT_ONLY;
delete process.env.UPLOADS_ENABLED;

// Configured ImageKit: without it the details lookup refuses before the gates
// under test are reached.
process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
process.env.IMAGEKIT_PUBLIC_KEY = 'public_test';
process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/test';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleMedia } = await import('../server/routes/api/media.js');
const { initializeMediaProvider } = await import('../server/media/index.js');

const USER = { email: 'olive@example.com', name: 'Olive', organizationId: ORG };
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const FILE_ID = 'ik-file-1';
const CANONICAL_URL = 'https://ik.imagekit.io/test/team/olive.jpg';
const DETAILS_URL = `https://api.imagekit.io/v1/files/${FILE_ID}/details`;

// A tiny GIF: the local provider passes GIFs through without sharp, so
// arbitrary bytes stand in for a real raster.
const GIF_BYTES = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
]);

let uploadsTmpDir;
const savedFetch = globalThis.fetch;

test.before(async () => {
  uploadsTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b327-media-'));
  process.env.UPLOADS_DIR = uploadsTmpDir;
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
  await initializeMediaProvider(process.cwd());
});

test.after(async () => {
  globalThis.fetch = savedFetch;
  __resetStorageForTests();
  __setTestDb(null);
  delete process.env.UPLOADS_DIR;
  if (uploadsTmpDir)
    await fs.rm(uploadsTmpDir, { recursive: true, force: true });
});

/**
 * Stand in for both hops the route makes: ImageKit's details API and the image
 * fetch itself. `image` decides what the second hop answers.
 *
 * @param {Object} [opts]
 * @param {Object|null} [opts.details] - body for the details call; null = 404.
 * @param {'ok'|'fail'} [opts.image] - how the image fetch behaves.
 * @returns {{fetched: string[]}} the URLs that were actually fetched
 */
function stubFetch({
  details = { url: CANONICAL_URL, name: 'olive.jpg' },
} = {}) {
  const seen = { fetched: [] };
  globalThis.fetch = async (rawUrl) => {
    const u = String(rawUrl);
    seen.fetched.push(u);
    if (u.startsWith(DETAILS_URL)) {
      if (!details) {
        return {
          ok: false,
          status: 404,
          headers: { get: () => 'application/json' },
          text: async () => '{"message":"not found"}',
          json: async () => ({ message: 'not found' }),
        };
      }
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
        get: (h) => (h.toLowerCase() === 'content-type' ? 'image/gif' : null),
      },
      arrayBuffer: async () => GIF_BYTES.buffer.slice(0, GIF_BYTES.length),
    };
  };
  return seen;
}

/** A response double capturing the status/body the http helpers write. */
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

/** Drive `handleMedia` the way the router does. */
async function call(method, pathAndQuery, { as = null, body } = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  const authedUser = as || undefined;
  const handled = await handleMedia({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test${pathAndQuery}`),
    authedUser,
  });
  return { handled, res };
}

const importImage = (body, opts) =>
  call('POST', '/api/media/imagekit/import', { body, ...opts });

// ===========================================================================
// The happy path: bytes land in own media, the answer is an own URL
// ===========================================================================

test('copies the asset into own media and answers a URL this install serves', async () => {
  const seen = stubFetch();
  const { res } = await importImage({ fileId: FILE_ID }, { as: USER });

  assert.equal(res.statusCode, 201);
  assert.ok(
    res.body.url.startsWith('/uploads/'),
    `expected an own-media URL, got ${res.body.url}`,
  );
  assert.notEqual(res.body.url, CANONICAL_URL);
  assert.equal(res.body.sourceUrl, CANONICAL_URL);
  assert.equal(res.body.mime, 'image/gif');
  assert.ok(res.body.bytes > 0);

  // The fileId was resolved at the source before anything was fetched.
  assert.ok(seen.fetched[0].startsWith(DETAILS_URL));
  assert.equal(seen.fetched[1], CANONICAL_URL);

  // And the bytes really are on disk, not just promised.
  const onDisk = path.join(
    uploadsTmpDir,
    res.body.url.replace('/uploads/', ''),
  );
  const stat = await fs.stat(onDisk);
  assert.ok(stat.size > 0, 'the copied image was written to own media');
});

test('the stored object is named after the DAM asset, so it stays recognisable', async () => {
  stubFetch({ details: { url: CANONICAL_URL, name: 'team-photo.jpg' } });
  const { res } = await importImage({ fileId: FILE_ID }, { as: USER });

  assert.equal(res.statusCode, 201);
  assert.match(
    res.body.url,
    /\/uploads\/team-photo-/,
    `expected the asset name in the key, got ${res.body.url}`,
  );
});

// ===========================================================================
// The URL is not the caller's to choose (no generic proxy)
// ===========================================================================

test("a transformation on the file's own URL is kept", async () => {
  const withTr = `${CANONICAL_URL}?tr=n-deck_slide_full_2x`;
  const seen = stubFetch();
  const { res } = await importImage(
    { fileId: FILE_ID, url: withTr },
    { as: USER },
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.sourceUrl, withTr, 'the transformation survives');
  assert.equal(seen.fetched[1], withTr);
});

test('a URL that is not this file is refused, and never fetched', async () => {
  const seen = stubFetch();
  const { res } = await importImage(
    { fileId: FILE_ID, url: 'https://evil.example.com/internal.png' },
    { as: USER },
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /does not belong/i);
  assert.equal(
    seen.fetched.length,
    1,
    'only the details lookup happened; the foreign URL was never fetched',
  );
});

test('a URL that merely starts with the canonical one is refused', async () => {
  // `https://ik.imagekit.io/test/team/olive.jpg.evil.com/x` shares a prefix but
  // is a different host — only a `?` may follow.
  const seen = stubFetch();
  const { res } = await importImage(
    { fileId: FILE_ID, url: `${CANONICAL_URL}.evil.example.com/x` },
    { as: USER },
  );

  assert.equal(res.statusCode, 400);
  assert.equal(seen.fetched.length, 1);
});

test('SSRF: a file whose ImageKit URL resolves into private space is not fetched', async () => {
  // The URL comes from the details response, but a compromised or misconfigured
  // DAM must not become a way to read the server's own network: the shared
  // re-host helper runs the same guard the Notion import does.
  const seen = stubFetch({
    details: { url: 'http://169.254.169.254/latest/meta-data/img.jpg' },
  });
  const { res } = await importImage({ fileId: FILE_ID }, { as: USER });

  assert.equal(res.statusCode, 400);
  assert.equal(seen.fetched.length, 1, 'the blocked address was never fetched');
  assert.equal(res.body.error, 'import_failed');
});

// ===========================================================================
// Failures answer an error, never a URL (the editor leaves the slide alone)
// ===========================================================================

test('a failed image fetch refuses instead of handing back the ImageKit URL', async () => {
  stubFetch();
  const inner = globalThis.fetch;
  globalThis.fetch = async (rawUrl) => {
    if (String(rawUrl).startsWith(DETAILS_URL)) return inner(rawUrl);
    return {
      ok: false,
      status: 403,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    };
  };

  const { res } = await importImage({ fileId: FILE_ID }, { as: USER });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(
    res.body.url,
    undefined,
    'a refusal must not answer a URL of any kind — least of all the external one',
  );
});

test('a file the configured account does not have is refused', async () => {
  stubFetch({ details: null });
  const { res } = await importImage({ fileId: 'not-ours' }, { as: USER });

  assert.ok(res.statusCode >= 400, `expected a refusal, got ${res.statusCode}`);
  assert.equal(res.body.url, undefined);
});

test('fileId is required', async () => {
  stubFetch();
  const { res } = await importImage({}, { as: USER });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /fileId/);
});

// ===========================================================================
// The gate ladder: auth → uploads → provider, before the body is read
// ===========================================================================

test('anonymous is refused before anything is fetched', async () => {
  const seen = stubFetch();
  const { res } = await importImage({ fileId: FILE_ID });

  assert.equal(res.statusCode, 401);
  assert.equal(seen.fetched.length, 0);
});

test('a member of another organization is still a signed-in caller', async () => {
  // Tenancy on the copy is the *upload* rule, not a library ACL: the bytes are
  // not catalogued per organization (see media-library.md § Authz & tenancy),
  // so what decides is that the caller is authenticated on this instance.
  // Pinned so a later reading of "org-scoped" does not silently become a
  // cross-organization read of somebody's DAM.
  stubFetch();
  const { res } = await importImage(
    { fileId: FILE_ID },
    { as: { ...USER, organizationId: OTHER_ORG } },
  );
  assert.equal(res.statusCode, 201);
  assert.ok(res.body.url.startsWith('/uploads/'));
});

test('IMAGEKIT_ONLY refuses the copy — there is no own media to copy into', async () => {
  const seen = stubFetch();
  process.env.IMAGEKIT_ONLY = 'true';
  try {
    const { res } = await importImage({ fileId: FILE_ID }, { as: USER });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'uploads_disabled');
    assert.equal(seen.fetched.length, 0, 'refused before any call to ImageKit');
  } finally {
    delete process.env.IMAGEKIT_ONLY;
  }
});

test('uploads switched off refuses the copy the same way', async () => {
  const seen = stubFetch();
  process.env.UPLOADS_ENABLED = 'false';
  try {
    const { res } = await importImage({ fileId: FILE_ID }, { as: USER });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'uploads_disabled');
    assert.equal(seen.fetched.length, 0);
  } finally {
    delete process.env.UPLOADS_ENABLED;
  }
});

test('demo mode refuses the copy', async () => {
  const seen = stubFetch();
  process.env.DEMO_MODE = 'true';
  try {
    const { res } = await importImage({ fileId: FILE_ID }, { as: USER });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /demo\/sandbox/i);
    assert.equal(seen.fetched.length, 0);
  } finally {
    delete process.env.DEMO_MODE;
  }
});

test('GET is not a way in', async () => {
  const { res } = await call('GET', '/api/media/imagekit/import', { as: USER });
  assert.equal(res.statusCode, 405);
});
