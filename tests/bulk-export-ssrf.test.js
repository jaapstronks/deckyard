import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import { buildBulkExport } from '../server/export/bulk-export.js';

const ORG = 'bulk-export-org';
const PUBLIC_IMAGE = 'https://8.8.8.8/public.png';
const IMAGE_BYTES = Buffer.from('public-image-bytes');
const SECRET_BYTES = Buffer.from('internal-response-must-not-be-exported');
const MAX_BYTES = 15 * 1024 * 1024;

// Only the transport is stubbed: storage, URL validation and ZIP generation
// are real. IP literals keep every case independent of DNS and live services.
async function exportImages(t, urls, respond, { themes = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bulk-ssrf-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets/local.png'), 'local-image');
  const refs = [PUBLIC_IMAGE, '/assets/local.png', ...urls];
  __setTestDb(
    createFakeDb({
      image_library: themes
        ? []
        : refs.map((url, i) => ({
            id: `image-${i}`,
            organization_id: ORG,
            url,
          })),
      themes: themes
        ? refs.map((url, i) => ({
            id: `theme-${i}`,
            organization_id: ORG,
            slug: `theme-${i}`,
            logo_url: i % 2 === 0 ? url : null,
            logo_small_url: i % 2 === 1 ? url : null,
          }))
        : [],
    }),
  );
  t.after(() => __setTestDb(null));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url === PUBLIC_IMAGE) {
      return new Response(IMAGE_BYTES, {
        headers: { 'content-type': 'image/png' },
      });
    }
    return respond(url, options);
  });
  const result = await buildBulkExport({
    repoRoot: root,
    userEmail: 'exporter@example.com',
    organizationId: ORG,
    options: { includeImageLibrary: !themes, includeThemes: themes },
  });
  t.after(() => fs.rm(result.filePath, { force: true }));
  const zip = await JSZip.loadAsync(await fs.readFile(result.filePath));
  const urlMap = JSON.parse(
    await zip.file('assets/url-map.json').async('string'),
  );
  assert.deepEqual(
    Object.keys(urlMap).sort(),
    ['/assets/local.png', PUBLIC_IMAGE].sort(),
  );
  assert.deepEqual(
    await zip.file(urlMap[PUBLIC_IMAGE]).async('nodebuffer'),
    IMAGE_BYTES,
  );
  assert.equal(
    await zip.file(urlMap['/assets/local.png']).async('string'),
    'local-image',
  );
  const assets = Object.values(zip.files).filter(
    (f) =>
      !f.dir &&
      f.name.startsWith('assets/') &&
      f.name !== 'assets/url-map.json',
  );
  assert.equal(assets.length, 2);
  for (const file of assets) {
    assert.equal(
      (await file.async('nodebuffer')).includes(SECRET_BYTES),
      false,
    );
  }
  assert.equal(result.manifest.stats.imagesDownloaded, 1);
  assert.equal(result.manifest.stats.imagesLocal, 1);
  assert.equal(result.manifest.stats.imagesFailed, urls.length);
  const storedManifest = JSON.parse(
    await zip.file('manifest.json').async('string'),
  );
  assert.equal(storedManifest.stats.imagesFailed, urls.length);
  assert.ok(
    result.manifest.warnings.includes(
      `${urls.length} remote image(s) could not be downloaded`,
    ),
  );
  return calls;
}

const PRIVATE_URLS = [
  'http://127.0.0.1/private.png',
  'http://10.0.0.1/private.png',
  'http://192.168.1.1/private.png',
  'http://169.254.169.254/latest/meta-data/',
  'http://[::1]/private.png',
  'http://[fd12:3456::1]/private.png',
  'http://[fe80::1]/private.png',
  'http://[::ffff:a9fe:a9fe]/latest/meta-data/',
];

for (const themes of [false, true]) {
  test(`bulk ZIP blocks private library/logo URLs before transport (themes=${themes})`, async (t) => {
    const calls = await exportImages(
      t,
      PRIVATE_URLS,
      () =>
        new Response(SECRET_BYTES, {
          headers: { 'content-type': 'image/png' },
        }),
      { themes },
    );
    assert.deepEqual(
      calls.map((call) => call.url),
      [PUBLIC_IMAGE],
    );
  });
}

test('bulk ZIP refuses a public redirect without following it', async (t) => {
  const redirectUrl = 'https://8.8.8.8/redirect';
  const calls = await exportImages(t, [redirectUrl], (_url, options) => {
    // Model fetch redirect policy: default follows to the internal response.
    if (options?.redirect === 'error')
      throw new TypeError('fetch failed: redirect');
    return new Response(SECRET_BYTES, {
      headers: { 'content-type': 'image/png' },
    });
  });
  assert.equal(
    calls.find((call) => call.url === redirectUrl).options.redirect,
    'error',
  );
});

test('bulk ZIP refuses a non-image public response', async (t) => {
  await exportImages(
    t,
    ['https://8.8.8.8/data'],
    () =>
      new Response(SECRET_BYTES, {
        headers: { 'content-type': 'application/json' },
      }),
  );
});

test('bulk ZIP refuses oversized declared images before reading the body', async (t) => {
  let bodyRead = false;
  await exportImages(t, ['https://8.8.8.8/large.png'], () => ({
    ok: true,
    headers: new Headers({
      'content-type': 'image/png',
      'content-length': String(MAX_BYTES + 1),
    }),
    async arrayBuffer() {
      bodyRead = true;
      return SECRET_BYTES;
    },
  }));
  assert.equal(bodyRead, false);
});

test('bulk ZIP refuses oversized images even without a content-length header', async (t) => {
  await exportImages(
    t,
    ['https://8.8.8.8/large.png'],
    () =>
      new Response(Buffer.alloc(MAX_BYTES + 1, 0x61), {
        headers: { 'content-type': 'image/png' },
      }),
  );
});
