/**
 * The media / upload route layer (test-coverage gap map, B40 — surface 8,
 * "media/upload-pijplijn + unsplash/giphy").
 *
 * `server/routes/api/{media,uploads,stock-media}.js` are the upload pipeline
 * (presign/confirm, server-side data-URL upload, the ImageKit browse proxy) and
 * the two remote stock-media providers (Unsplash, Giphy) beside the bundled
 * gradients. Upload is a classic abuse surface, so the contract pinned here is
 * the gate ladder every write runs before it can touch a byte: who may upload
 * (auth), whether uploads are on at all (demo/sandbox), whether a provider is
 * even configured, and — for the local provider that ships with the OSS build —
 * the file-type and size doors on the upload itself.
 *
 * Two things carry this surface and are stated here as assertions:
 *
 *   1. **A write needs a signed-in caller, an enabled feature and a configured
 *      provider, checked in that order.** Every mutating handler returns 401
 *      before anything else, then refuses demo/sandbox mode, then refuses a
 *      missing provider — so a body is never parsed on a request that could not
 *      have succeeded. The local provider additionally refuses an unsupported
 *      content type and an over-size buffer: the file-type/size doors.
 *   2. **The stock-media providers are gated on configuration, not just auth.**
 *      Unsplash and Giphy answer "not available" (400) whenever their API key is
 *      missing or their instance toggle is off — which is the default — and the
 *      module lets an unauthenticated caller fall through to the outer auth gate
 *      rather than answering 401 itself.
 *
 * Feasibility note (opt-out, logged in briefs/test-coverage-gaps.md): the
 * branches that reach a real external service are not driven here — the Scaleway
 * S3 presigner, the ImageKit REST proxy (`listImageKitFiles`/`listImageKitTags`/
 * `getImageKitFileDetails`/`patchImageKitFileDetails`), and the Unsplash/Giphy
 * search+download hops — because each needs a configured provider and a network
 * peer. They are pinned only up to the last gate before the call. The local
 * provider IS driven end to end (it writes to a temp uploads dir), which is what
 * lets the upload happy path and the file-type/size doors be pinned for real.
 *
 * House shape (see `tests/analytics-routes-contract.test.js`): the exported
 * mount handler is called directly with a req/res double, dispatching on the URL
 * and method exactly as the router does. No HTTP server, no browser.
 *
 * Run with: node --test tests/media-upload-routes-contract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
// A stock-media provider is "configured" purely from these env keys; start from
// a known-empty state so the "not available" refusals are not answered by a key
// that happened to leak in from the shell (the enabled tests set them below).
delete process.env.UNSPLASH_ACCESS_KEY;
delete process.env.GIPHY_API_KEY;
delete process.env.DEMO_MODE;
delete process.env.SANDBOX_MODE;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleMedia } = await import('../server/routes/api/media.js');
const { handleUploads } = await import('../server/routes/api/uploads.js');
const { handleStockMedia } =
  await import('../server/routes/api/stock-media.js');
const { initializeMediaProvider } = await import('../server/media/index.js');

const USER = { email: 'olive@example.com', name: 'Olive', organizationId: ORG };

// A 1×1 transparent PNG — a real raster the local provider's sharp pass accepts.
const PNG_1PX_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMEAQDN9pR4AAAAAElFTkSuQmCC';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX_BASE64}`;

/** @type {ReturnType<typeof createFakeDb>} */
let db;
let uploadsTmpDir;

test.before(async () => {
  uploadsTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-media-'));
  process.env.UPLOADS_DIR = uploadsTmpDir;
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    }),
  );
  await initializeStorage();
});

test.after(async () => {
  __resetStorageForTests();
  __setTestDb(null);
  delete process.env.UPLOADS_DIR;
  if (uploadsTmpDir)
    await fs.rm(uploadsTmpDir, { recursive: true, force: true });
});

/** Reinstall a freshly seeded double; `appSettings` becomes the singleton bag. */
function seed(appSettings) {
  db = createFakeDb({
    organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
    app_settings:
      appSettings === undefined
        ? []
        : [{ id: 'singleton', settings: appSettings }],
  });
  __setTestDb(db);
  return db;
}

/** A response double capturing the status/headers/body the helpers write. */
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

/**
 * Drive a mount handler (`handleMedia`/`handleUploads`/`handleStockMedia`) the
 * way the router does: it dispatches on `ctx.url.pathname` and `ctx.req.method`.
 *
 * @param {Function} handle - The exported mount handler.
 * @param {string} method
 * @param {string} pathAndQuery
 * @param {Object} [options]
 * @param {Object|null} [options.as] - Acting user; omit for anonymous.
 * @param {Object} [options.body] - JSON request body.
 * @returns {Promise<{handled: *, res: Object}>}
 */
async function call(handle, method, pathAndQuery, { as = null, body } = {}) {
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
  const handled = await handle({
    repoRoot: process.cwd(),
    storageScope: createStorageScope(authedUser, { repoRoot: process.cwd() }),
    req,
    res,
    url: new URL(`http://decks.example.test${pathAndQuery}`),
    authedUser,
  });
  return { handled, res };
}

// ===========================================================================
// media.js — public status, then the auth → feature → provider gate ladder
// ===========================================================================

test('media status is public and reports no provider on a bare install', async () => {
  seed();
  const { res } = await call(handleMedia, 'GET', '/api/media/status');

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    mode: 'none',
    presignedSupported: false,
    imagekitAvailable: false,
  });
});

test('imagekit status is public and reports unconfigured on a bare install', async () => {
  seed();
  const { res } = await call(handleMedia, 'GET', '/api/media/imagekit/status');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.configured, false);
  assert.ok(
    res.body.issues.some((i) => /IMAGEKIT_PRIVATE_KEY/.test(i)),
    'the missing-key issues are surfaced',
  );
});

test('presign refuses an unauthenticated caller with a 401', async () => {
  seed();
  const { res } = await call(handleMedia, 'POST', '/api/media/presign', {
    body: { filename: 'a.png', contentType: 'image/png' },
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('presign refuses demo/sandbox mode with a 400 before touching the provider', async () => {
  seed();
  process.env.DEMO_MODE = 'true';
  try {
    const { res } = await call(handleMedia, 'POST', '/api/media/presign', {
      as: USER,
      body: { filename: 'a.png', contentType: 'image/png' },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'bad_request');
    assert.match(res.body.message, /disabled in demo\/sandbox/i);
  } finally {
    delete process.env.DEMO_MODE;
  }
});

test('presign refuses a missing provider with a 400', async () => {
  seed();
  const { res } = await call(handleMedia, 'POST', '/api/media/presign', {
    as: USER,
    body: { filename: 'a.png', contentType: 'image/png' },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /provider not initialized/i);
});

test('confirm refuses an unauthenticated caller with a 401', async () => {
  seed();
  const { res } = await call(handleMedia, 'POST', '/api/media/confirm', {
    body: { key: 'k' },
  });

  assert.equal(res.statusCode, 401);
});

test('confirm refuses a missing provider with a 400', async () => {
  seed();
  const { res } = await call(handleMedia, 'POST', '/api/media/confirm', {
    as: USER,
    body: { key: 'k' },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /provider not initialized/i);
});

test('the imagekit detail write refuses an unauthenticated caller with a 401', async () => {
  seed();
  const { res } = await call(
    handleMedia,
    'PATCH',
    '/api/media/imagekit/files/abc/details',
    {
      body: {},
    },
  );

  assert.equal(res.statusCode, 401);
});

test('the imagekit detail write is refused with a 405 in demo/sandbox mode', async () => {
  seed();
  process.env.SANDBOX_MODE = 'true';
  try {
    const { res } = await call(
      handleMedia,
      'PATCH',
      '/api/media/imagekit/files/abc/details',
      {
        as: USER,
        body: {},
      },
    );

    assert.equal(
      res.statusCode,
      405,
      'sandbox makes the write path method-not-allowed',
    );
    assert.equal(res.body.error, 'method_not_allowed');
  } finally {
    delete process.env.SANDBOX_MODE;
  }
});

test('a wrong method on a media path is a 405, not a fall-through', async () => {
  seed();
  const { res } = await call(handleMedia, 'DELETE', '/api/media/presign');

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'POST');
});

// ===========================================================================
// uploads.js — auth → feature, then the body/provider ordering
// ===========================================================================

test('upload refuses an unauthenticated caller with a 401', async () => {
  seed();
  const { res } = await call(handleUploads, 'POST', '/api/uploads', {
    body: { dataUrl: PNG_DATA_URL },
  });

  assert.equal(res.statusCode, 401);
});

test('upload refuses demo/sandbox mode with a 400', async () => {
  seed();
  process.env.DEMO_MODE = 'true';
  try {
    const { res } = await call(handleUploads, 'POST', '/api/uploads', {
      as: USER,
      body: { dataUrl: PNG_DATA_URL },
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /disabled in demo\/sandbox/i);
  } finally {
    delete process.env.DEMO_MODE;
  }
});

test('upload rejects a body without a data URL with a 400', async () => {
  seed();
  const { res } = await call(handleUploads, 'POST', '/api/uploads', {
    as: USER,
    body: { originalName: 'a.png' },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Expected \{ dataUrl/);
});

// ===========================================================================
// stock-media.js — the status probe, then the configuration gate
// ===========================================================================

test('stock-media status is public and reports the bare-install shape', async () => {
  seed();
  const { res } = await call(
    handleStockMedia,
    'GET',
    '/api/stock-media/status',
  );

  assert.equal(res.statusCode, 200);
  assert.equal(
    res.body.bundled.configured,
    true,
    'bundled has nothing to configure',
  );
  assert.equal(res.body.bundled.enabled, false, 'and is off until toggled on');
  assert.equal(res.body.unsplash.configured, false, 'no UNSPLASH_ACCESS_KEY');
  assert.equal(res.body.giphy.configured, false, 'no GIPHY_API_KEY');
});

test('an authed-only stock-media route falls through (not 401) for an anonymous caller', async () => {
  seed();
  const { handled, res } = await call(
    handleStockMedia,
    'GET',
    '/api/stock-media/unsplash/search?q=cats',
  );

  assert.equal(
    handled,
    false,
    'the module defers the auth decision to the outer gate',
  );
  assert.equal(res.statusCode, null, 'and writes nothing itself');
});

test('bundled manifest is a 400 while the bundled source is toggled off', async () => {
  seed();
  const { res } = await call(
    handleStockMedia,
    'GET',
    '/api/stock-media/bundled/manifest',
    {
      as: USER,
    },
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Bundled gradients are not available/);
});

test('unsplash search is a 400 while Unsplash is unconfigured', async () => {
  seed();
  const { res } = await call(
    handleStockMedia,
    'GET',
    '/api/stock-media/unsplash/search?q=cats',
    {
      as: USER,
    },
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Unsplash is not available/);
});

test('unsplash download is a 400 while Unsplash is unconfigured', async () => {
  seed();
  const { res } = await call(
    handleStockMedia,
    'POST',
    '/api/stock-media/unsplash/download',
    {
      as: USER,
      body: { photoId: 'p1' },
    },
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Unsplash is not available/);
});

test('giphy search is a 400 while Giphy is unconfigured', async () => {
  seed();
  const { res } = await call(
    handleStockMedia,
    'GET',
    '/api/stock-media/giphy/search?q=cats',
    {
      as: USER,
    },
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Giphy is not available/);
});

test('giphy download is a 400 while Giphy is unconfigured', async () => {
  seed();
  const { res } = await call(
    handleStockMedia,
    'POST',
    '/api/stock-media/giphy/download',
    {
      as: USER,
      body: { gifId: 'g1' },
    },
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Giphy is not available/);
});

// With a key present and the instance toggle on, the "not available" gate opens
// and the *next* gate — the required search term / id — becomes reachable. This
// is what proves the "not available" refusals above are non-vacuous: flip the
// two inputs and a different 400 answers.
test('a configured-and-enabled Unsplash still rejects an empty query with a 400', async () => {
  seed({ stockMedia: { unsplash: { enabled: true } } });
  process.env.UNSPLASH_ACCESS_KEY = 'test-unsplash-key';
  try {
    const { res } = await call(
      handleStockMedia,
      'GET',
      '/api/stock-media/unsplash/search?q=',
      {
        as: USER,
      },
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Search query required/);
  } finally {
    delete process.env.UNSPLASH_ACCESS_KEY;
  }
});

test('a configured-and-enabled Unsplash download still rejects a missing photo id', async () => {
  seed({ stockMedia: { unsplash: { enabled: true } } });
  process.env.UNSPLASH_ACCESS_KEY = 'test-unsplash-key';
  try {
    const { res } = await call(
      handleStockMedia,
      'POST',
      '/api/stock-media/unsplash/download',
      {
        as: USER,
        body: {},
      },
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Photo ID required/);
  } finally {
    delete process.env.UNSPLASH_ACCESS_KEY;
  }
});

test('a configured-and-enabled Giphy still rejects an empty query with a 400', async () => {
  seed({ stockMedia: { giphy: { enabled: true } } });
  process.env.GIPHY_API_KEY = 'test-giphy-key';
  try {
    const { res } = await call(
      handleStockMedia,
      'GET',
      '/api/stock-media/giphy/search?q=',
      {
        as: USER,
      },
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /Search query required/);
  } finally {
    delete process.env.GIPHY_API_KEY;
  }
});

test('a configured-and-enabled Giphy download still rejects a missing gif id', async () => {
  seed({ stockMedia: { giphy: { enabled: true } } });
  process.env.GIPHY_API_KEY = 'test-giphy-key';
  try {
    const { res } = await call(
      handleStockMedia,
      'POST',
      '/api/stock-media/giphy/download',
      {
        as: USER,
        body: {},
      },
    );

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /GIF ID required/);
  } finally {
    delete process.env.GIPHY_API_KEY;
  }
});

// ===========================================================================
// The local provider — the upload doors, driven end to end
//
// These run last and initialize the singleton media provider (there is no
// un-init), so every "no provider" refusal above is asserted while the singleton
// is still empty. From here on a real LocalProvider writes to a temp uploads dir.
// ===========================================================================

test('presign against the local provider is a 400 — it has no presigned uploads', async () => {
  seed();
  await initializeMediaProvider(process.cwd());

  const { res } = await call(handleMedia, 'POST', '/api/media/presign', {
    as: USER,
    body: { filename: 'a.png', contentType: 'image/png' },
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /does not support presigned uploads/i);
});

test('confirm against the local provider validates the key before the filesystem', async () => {
  seed();
  await initializeMediaProvider(process.cwd());

  const { res } = await call(handleMedia, 'POST', '/api/media/confirm', {
    as: USER,
    body: {},
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /key is required/);
});

test('a valid data-URL upload is stored and returns 201 with its metadata', async () => {
  seed();
  await initializeMediaProvider(process.cwd());

  const { res } = await call(handleUploads, 'POST', '/api/uploads', {
    as: USER,
    body: { dataUrl: PNG_DATA_URL, originalName: 'hero.png' },
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.mime, 'image/png');
  assert.match(
    res.body.url,
    /^\/uploads\/.+\.png$/,
    'a public URL under /uploads is returned',
  );
  assert.ok(res.body.bytes > 0, 'the stored byte count is reported');

  // The bytes really landed in the temp uploads dir, not just in the response.
  const key = res.body.filename;
  const stat = await fs.stat(path.join(uploadsTmpDir, key));
  assert.ok(stat.isFile(), 'the upload is on disk');
});

test('the upload file-type door rejects an unsupported content type with a 400', async () => {
  seed();
  await initializeMediaProvider(process.cwd());

  const { res } = await call(handleUploads, 'POST', '/api/uploads', {
    as: USER,
    body: {
      dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
      originalName: 'evil.pdf',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'upload_failed');
  assert.match(res.body.message, /Unsupported content type/);
});

test('the upload size door rejects an over-size buffer with a 400', async () => {
  seed();
  await initializeMediaProvider(process.cwd());

  // 11 MB of bytes labelled image/png: the size door (10 MB) is checked before
  // the sharp optimize pass, so the payload need not be a real PNG to trip it.
  const oversized = Buffer.alloc(11 * 1024 * 1024, 0x41).toString('base64');
  const { res } = await call(handleUploads, 'POST', '/api/uploads', {
    as: USER,
    body: {
      dataUrl: `data:image/png;base64,${oversized}`,
      originalName: 'huge.png',
    },
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'upload_failed');
  assert.match(res.body.message, /File too large/);
});
