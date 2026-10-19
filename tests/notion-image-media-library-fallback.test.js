/**
 * Notion import re-hosts images through the own media library when ImageKit
 * is not configured, so an imported deck survives Notion's ~1h signed-URL
 * expiry (B80).
 *
 * Pins the D29-1 decision: without ImageKit, `processNotionImages` fetches each
 * Notion image and stores it via the configured media provider, rewriting the
 * block URL to the durable local URL. On a fetch/store failure it returns no
 * URL, so the source-image resolver can clear the field and warn.
 *
 * Run with: node --test tests/notion-image-media-library-fallback.test.js
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Ensure ImageKit is treated as unconfigured for every case in this file, so the
// media-library fallback is the path under test.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('IMAGEKIT_')) delete process.env[key];
}

const { processNotionImages } =
  await import('../server/utils/convert-notion.js');
const { initializeMediaProvider } = await import('../server/media/index.js');

const SIGNED_URL =
  'https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/img.jpg?X-Amz-Expires=3600&sig=deadbeef';

// A tiny GIF payload — the local provider does not run GIFs through sharp, so
// arbitrary bytes are stored verbatim without needing a valid raster image.
const GIF_BYTES = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
]);

let tmpRoot;
const savedFetch = globalThis.fetch;

before(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'b80-media-'));
  // Local provider writes to <repoRoot>/server/uploads → keep it in the temp dir.
  await initializeMediaProvider(tmpRoot);
});

after(async () => {
  globalThis.fetch = savedFetch;
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  globalThis.fetch = savedFetch;
});

test('re-hosts each image through the media library and rewrites to a durable URL', async () => {
  let fetchedUrl = null;
  globalThis.fetch = async (url) => {
    fetchedUrl = url;
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'image/gif' : null),
      },
      arrayBuffer: async () => GIF_BYTES.buffer.slice(0, GIF_BYTES.length),
    };
  };

  const [result] = await processNotionImages([
    { url: SIGNED_URL, caption: 'A caption', blockId: 'block-1' },
  ]);

  assert.equal(
    fetchedUrl,
    SIGNED_URL,
    'fetches the original signed Notion URL',
  );
  assert.equal(result.originalUrl, SIGNED_URL);
  assert.equal(result.caption, 'A caption');
  assert.ok(
    result.uploadedUrl.startsWith('/uploads/'),
    `expected a durable /uploads/ URL, got ${result.uploadedUrl}`,
  );
  assert.notEqual(
    result.uploadedUrl,
    SIGNED_URL,
    'no longer the expiring signed URL',
  );

  // The bytes actually landed on disk under the temp uploads dir.
  const key = result.uploadedUrl.replace('/uploads/', '');
  const onDisk = path.join(tmpRoot, 'server', 'uploads', key);
  const stat = await fs.stat(onDisk);
  assert.ok(
    stat.size > 0,
    'the re-hosted image was written to the media library',
  );
});

test('SSRF: a private-range image URL is never fetched or used', async () => {
  // A Notion `external` image URL is attacker-controllable; one pointing at a
  // private/link-local address (here the cloud metadata endpoint) must be
  // refused before any fetch leaves the server. The guard checks the IP
  // literal directly, so this needs no DNS.
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error('fetch must not be called for a blocked URL');
  };

  const METADATA_URL = 'http://169.254.169.254/latest/meta-data/img.jpg';
  const [result] = await processNotionImages([
    { url: METADATA_URL, caption: '', blockId: 'block-ssrf' },
  ]);

  assert.equal(fetched, false, 'the blocked URL is never fetched');
  assert.equal(result.uploadedUrl, '');
  assert.equal(result.originalUrl, METADATA_URL);
});

test('the re-host fetch goes through the hardened helper: no redirects, with a timeout', async () => {
  // A redirect from a public host into private space would bypass a
  // check-then-plain-fetch sequence, so the call site must use
  // safeFetchRemoteImage, which fetches with redirect: 'error' and a signal.
  let imageFetchOpts;
  globalThis.fetch = async (url, opts) => {
    if (imageFetchOpts === undefined) imageFetchOpts = opts;
    return {
      ok: true,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'image/gif' : null),
      },
      arrayBuffer: async () => GIF_BYTES.buffer.slice(0),
    };
  };

  await processNotionImages([
    { url: SIGNED_URL, caption: '', blockId: 'block-redirect' },
  ]);

  assert.equal(
    imageFetchOpts?.redirect,
    'error',
    'the re-host fetch must refuse redirects',
  );
  assert.ok(
    imageFetchOpts?.signal,
    'the re-host fetch must carry a timeout signal',
  );
});

test('returns no URL when the media-provider fetch fails', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    headers: { get: () => null },
    arrayBuffer: async () => new ArrayBuffer(0),
  });

  const [result] = await processNotionImages([
    { url: SIGNED_URL, caption: '', blockId: 'block-2' },
  ]);

  assert.equal(result.uploadedUrl, '');
  assert.equal(result.originalUrl, SIGNED_URL);
});

test('ImageKit copies return durable URLs, clear failures and propagate cancellation', async () => {
  const keys = [
    'IMAGEKIT_PRIVATE_KEY',
    'IMAGEKIT_PUBLIC_KEY',
    'IMAGEKIT_URL_ENDPOINT',
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.IMAGEKIT_PRIVATE_KEY = 'private_test';
  process.env.IMAGEKIT_PUBLIC_KEY = 'public_test';
  process.env.IMAGEKIT_URL_ENDPOINT = 'https://ik.imagekit.io/test';
  const image = 'https://8.8.8.8/source.gif';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response(GIF_BYTES, {
        headers: { 'Content-Type': 'image/gif' },
      });
    }
    return new Response('upload unavailable', { status: 503 });
  };
  try {
    const [result] = await processNotionImages([
      { url: image, caption: '', blockId: 'block-imagekit-fail' },
    ]);
    assert.equal(result.uploadedUrl, '');
    assert.equal(result.originalUrl, image);
    assert.equal(calls, 2, 'the source fetch succeeds before ImageKit refuses');

    const durableUrl = 'https://ik.imagekit.io/test/copied.gif';
    globalThis.fetch = async (url) =>
      String(url) === image
        ? new Response(GIF_BYTES, { headers: { 'Content-Type': 'image/gif' } })
        : Response.json({ url: durableUrl });
    const [copied] = await processNotionImages([{ url: image }]);
    assert.equal(copied.uploadedUrl, durableUrl);

    const controller = new AbortController();
    globalThis.fetch = async () => {
      controller.abort();
      return new Response('cancelled', { status: 503 });
    };
    await assert.rejects(
      processNotionImages([{ url: image }], { signal: controller.signal }),
      { name: 'AbortError' },
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('returns no URL when no media provider is initialized', () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('IMAGEKIT_')) delete env[key];
  }
  const moduleUrl = new URL(
    '../server/utils/convert-notion.js',
    import.meta.url,
  ).href;
  const script = `
    const { processNotionImages } = await import(${JSON.stringify(moduleUrl)});
    const [image] = await processNotionImages([{ url: 'https://8.8.8.8/image.gif' }]);
    if (image.uploadedUrl !== '') process.exit(1);
  `;
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env,
      stdio: 'pipe',
    }),
  );
});

test('an abort during a media copy propagates', async () => {
  const controller = new AbortController();
  globalThis.fetch = async () => {
    controller.abort();
    return { ok: false, status: 503 };
  };
  await assert.rejects(
    processNotionImages(
      [{ url: SIGNED_URL, caption: '', blockId: 'block-abort' }],
      { signal: controller.signal },
    ),
  );
});
