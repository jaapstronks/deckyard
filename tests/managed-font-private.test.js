/**
 * B510 — uploaded font variants are private media objects, served by the app.
 *
 * The contract, end to end over the local provider:
 *
 *   1. `upload-variant` stores the file as a private object (`private/fonts/…`
 *      under the data dir), never under `/uploads/`, and the variant's URL is
 *      the derived app route `/fonts/managed/<file>`.
 *   2. That route serves the bytes, with headers that keep it off shared
 *      caches, search indexes and other sites; the `/uploads/` path does not.
 *   3. The export CSS (what PDF/PNG/HTML exports inline) embeds the font by
 *      reading it through the provider — there is no public URL to fetch.
 *
 * The S3 half (no object may be publicly readable) is pinned in
 * `tests/s3-private-object.test.js`.
 *
 * Run with: node --test tests/managed-font-private.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'b510-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.MEDIA_STORAGE_MODE = 'local';
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.MULTI_ORG_ENABLED;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const repoRoot = process.cwd();

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleFontFamilies } =
  await import('../server/routes/api/font-families.js');
const { initializeMediaProvider, getMediaProvider } =
  await import('../server/media/index.js');
const { handleManagedFont } =
  await import('../server/routes/static/managed-fonts.js');
const { handleStaticFiles } =
  await import('../server/routes/static/static-files.js');
const { SHARED_PUBLIC_DIRS } = await import('../server/config/paths.js');
const { managedFontUrl, managedFontKeyFromUrl } =
  await import('../server/media/managed-fonts.js');
const { loadExportCssBundle } = await import('../server/export/css-bundle.js');
const { buildEmbeddedFontCss } = await import('../server/utils/embed-fonts.js');
const { buildThemeConfig } = await import('../server/utils/theme-builder.js');
const { handleMedia } = await import('../server/routes/api/media.js');
const { privatizeFontVariants } =
  await import('../scripts/privatize-font-variants.js');

const DESIGNER = {
  email: 'designer@example.com',
  name: 'Dana Designer',
  organizationId: ORG,
  isDesigner: true,
};

// A woff2 as far as the upload route checks: the `wOF2` magic, then bytes
// distinctive enough to find again in base64.
const FONT_BYTES = Buffer.concat([
  Buffer.from([0x77, 0x4f, 0x46, 0x32]),
  Buffer.from('licensed-glyph-outlines-b510'),
]);

test.before(async () => {
  __setTestDb(
    createFakeDb({ organizations: [{ id: ORG, name: 'D', slug: 'd' }] }),
  );
  await initializeStorage();
  await initializeMediaProvider(repoRoot);
});

test.after(async () => {
  __resetStorageForTests();
  __setTestDb(null);
  await fs.rm(tmp, { recursive: true, force: true });
});

function seed() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'D', slug: 'd' }],
    users: [
      {
        id: 'user-designer',
        organization_id: ORG,
        email: DESIGNER.email,
        name: DESIGNER.name,
        role: 'user',
        auth_source: 'database',
        settings: {},
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    font_families: [],
    font_variants: [],
  });
  __setTestDb(db);
  return db;
}

function makeRes() {
  const chunks = [];
  return {
    statusCode: null,
    headers: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      if (payload) chunks.push(Buffer.from(payload));
      return this;
    },
    get buffer() {
      return Buffer.concat(chunks);
    },
    get json() {
      try {
        return JSON.parse(this.buffer.toString('utf8'));
      } catch {
        return null;
      }
    },
  };
}

async function api(method, pathname, body) {
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
  await handleFontFamilies({
    repoRoot,
    storageScope: createStorageScope(DESIGNER, { repoRoot }),
    req,
    res,
    url: new URL(`http://decks.example.test${pathname}`),
    authedUser: DESIGNER,
  });
  return res;
}

async function get(pathname, headers = {}) {
  const req = { method: 'GET', headers };
  const res = makeRes();
  const url = new URL(`http://decks.example.test${pathname}`);
  const handled =
    (await handleManagedFont({ req, res, url })) ||
    handleStaticFiles({ res, url, sharedPublicDirs: SHARED_PUBLIC_DIRS });
  // serveFile is async behind a sync handler; let it settle.
  await new Promise((r) => setTimeout(r, 20));
  return { handled, res };
}

async function uploadVariant() {
  const family = await api('POST', '/api/font-families', {
    name: 'Licensed Sans',
    source: 'upload',
  });
  assert.equal(family.statusCode, 201);
  const up = await api(
    'POST',
    `/api/font-families/${family.json.id}/upload-variant`,
    {
      dataUrl: `data:font/woff2;base64,${FONT_BYTES.toString('base64')}`,
      weight: 400,
      style: 'normal',
      format: 'woff2',
    },
  );
  assert.equal(up.statusCode, 201, JSON.stringify(up.json));
  return { familyId: family.json.id, variant: up.json };
}

test('an uploaded variant is a private object with a derived app-route URL', async () => {
  seed();
  const { variant } = await uploadVariant();

  assert.match(variant.filename, /^private\/fonts\/licensed-sans-400-normal-/);
  assert.match(
    variant.url,
    /^\/fonts\/managed\/licensed-sans-400-normal-.+\.woff2$/,
  );

  const file = variant.filename.slice('private/fonts/'.length);
  const onDisk = await fs.readFile(
    path.join(process.env.DATA_DIR, 'private-media', 'fonts', file),
  );
  assert.deepEqual(onDisk, FONT_BYTES);
  await assert.rejects(
    fs.access(path.join(process.env.UPLOADS_DIR, file)),
    'nothing lands in the public uploads dir',
  );
});

test('the app route serves the variant; the public static roots do not', async () => {
  seed();
  const { variant } = await uploadVariant();

  const served = await get(variant.url);
  assert.equal(served.res.statusCode, 200);
  assert.deepEqual(served.res.buffer, FONT_BYTES);
  assert.equal(served.res.headers['Content-Type'], 'font/woff2');
  assert.match(served.res.headers['Cache-Control'], /^private/);
  assert.equal(
    served.res.headers['Cross-Origin-Resource-Policy'],
    'same-origin',
  );
  assert.equal(served.res.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.equal(
    served.res.headers['Access-Control-Allow-Origin'],
    undefined,
    'no CORS grant: another site cannot use the font in @font-face',
  );

  const file = variant.filename.split('/').pop();
  for (const p of [`/uploads/${file}`, `/uploads/private/fonts/${file}`]) {
    const direct = await get(p);
    assert.equal(direct.res.statusCode, 404, `${p} must not serve the font`);
  }
});

test('the route refuses cross-site requests and names it never handed out', async () => {
  seed();
  const { variant } = await uploadVariant();

  const cross = await get(variant.url, { 'sec-fetch-site': 'cross-site' });
  assert.equal(cross.res.statusCode, 403);

  const sameSite = await get(variant.url, { 'sec-fetch-site': 'same-origin' });
  assert.equal(sameSite.res.statusCode, 200);

  for (const p of [
    '/fonts/managed/..%2F..%2Fsecret.woff2',
    '/fonts/managed/x.txt',
    '/fonts/managed/',
    '/fonts/managed/missing-00000000.woff2',
  ]) {
    const r = await get(p);
    assert.equal(r.res.statusCode, 404, p);
  }
});

test('the URL is derived from the key and maps back to it, nothing else', () => {
  const key = 'private/fonts/gt-america-500-normal-abc.woff2';
  const url = managedFontUrl(key);
  assert.equal(url, '/fonts/managed/gt-america-500-normal-abc.woff2');
  assert.equal(managedFontKeyFromUrl(url), key);

  assert.equal(managedFontUrl('uploads/2026/09/x.woff2'), null);
  assert.equal(managedFontUrl('x.woff2'), null);
  assert.equal(managedFontUrl(null), null);
  assert.equal(managedFontKeyFromUrl('/uploads/x.woff2'), null);
  assert.equal(managedFontKeyFromUrl('/fonts/managed/a%2Fb.woff2'), null);
});

test('the export CSS embeds a private variant read through the provider', async () => {
  seed();
  const { familyId } = await uploadVariant();
  const family = await api('GET', `/api/font-families/${familyId}`);
  assert.equal(family.statusCode, 200);

  const amethyst = JSON.parse(
    await fs.readFile(path.join(repoRoot, 'themes', 'amethyst.json'), 'utf8'),
  );
  const theme = buildThemeConfig(
    {
      id: '00000000-0000-4000-8000-0000000000ab',
      ...amethyst,
      fonts: {
        ...amethyst.fonts,
        heading: 'Licensed Sans',
        headingFamilyId: familyId,
      },
    },
    { managedFonts: [family.json] },
  );
  const entry = theme.embedFonts.find((f) => f.family === 'Licensed Sans');
  assert.match(entry.url, /^\/fonts\/managed\//, 'the theme names the route');

  const bundle = await loadExportCssBundle(repoRoot, theme, null, {
    slides: [],
  });
  const css = JSON.stringify(bundle);
  assert.ok(
    css.includes(`data:font/woff2;base64,${FONT_BYTES.toString('base64')}`),
    'the private font is inlined into the export document',
  );
  assert.ok(
    !css.includes(entry.url),
    'the export document does not point at the route',
  );
});

test('removing a variant deletes its private object', async () => {
  seed();
  const { familyId, variant } = await uploadVariant();
  const del = await api(
    'DELETE',
    `/api/font-families/${familyId}/variants/${variant.id}`,
  );
  assert.equal(del.statusCode, 200);
  assert.equal(await getMediaProvider().readFile(variant.filename), null);
});

test('the export skips a managed variant whose object is gone, with a warning', async (t) => {
  seed();
  const { variant } = await uploadVariant();
  await getMediaProvider().deleteFile(variant.filename);
  const warn = t.mock.method(console, 'warn', () => {});

  const css = await buildEmbeddedFontCss(repoRoot, {
    embedFonts: [
      { family: 'Licensed Sans', url: managedFontUrl(variant.filename) },
    ],
  });
  assert.equal(css, '', 'the face is dropped, the export goes on');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments.join(' '),
    /Skipping font \/fonts\/managed\/.+: stored object not found/,
  );
});

test('the export skips a managed variant storage cannot read, with the reason (B539)', async (t) => {
  seed();
  const { variant } = await uploadVariant();
  // Not a missing object (that is `null`): the read itself fails, as an S3
  // read does on a permission or network error.
  t.mock.method(getMediaProvider(), 'readFile', async () => {
    throw new Error('AccessDenied');
  });
  const warn = t.mock.method(console, 'warn', () => {});

  const css = await buildEmbeddedFontCss(repoRoot, {
    embedFonts: [
      { family: 'Licensed Sans', url: managedFontUrl(variant.filename) },
    ],
  });
  assert.equal(css, '', 'the face is dropped, the export goes on');
  assert.equal(warn.mock.callCount(), 1);
  assert.match(
    warn.mock.calls[0].arguments.join(' '),
    /Skipping font \/fonts\/managed\/.+: stored object unreadable \(AccessDenied\)/,
  );
});

test('privatize-font-variants moves a pre-B510 public variant into private storage', async () => {
  const db = seed();
  const provider = getMediaProvider();
  const legacy = await provider.uploadBuffer({
    buffer: FONT_BYTES,
    filename: 'old-font',
    contentType: 'font/woff2',
  });
  db.__tables.font_families.push({
    id: '00000000-0000-4000-8000-00000000f001',
    organization_id: ORG,
    name: 'Old Font',
    slug: 'old-font',
    source: 'upload',
  });
  db.__tables.font_variants.push({
    id: '00000000-0000-4000-8000-00000000f002',
    font_family_id: '00000000-0000-4000-8000-00000000f001',
    weight: 700,
    style: 'normal',
    filename: legacy.key,
    format: 'woff2',
  });

  const check = await privatizeFontVariants(db, provider, { apply: false });
  assert.equal(check.pending, 1);

  const applied = await privatizeFontVariants(db, provider, { apply: true });
  assert.equal(applied.moved.length, 1);
  assert.equal(applied.pending, 0);

  const row = db.__tables.font_variants[0];
  assert.match(row.filename, /^private\/fonts\/old-font-700-normal-/);
  assert.deepEqual(await provider.readFile(row.filename), FONT_BYTES);
  assert.equal(
    await provider.readFile(legacy.key),
    null,
    'the public copy is gone',
  );

  const again = await privatizeFontVariants(db, provider, { apply: true });
  assert.equal(again.moved.length, 0, 'a second run does nothing');
});

test('the media confirm route will not address a private key', async () => {
  seed();
  const { variant } = await uploadVariant();
  const payload = JSON.stringify({ key: variant.filename });
  const req = {
    method: 'POST',
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = makeRes();
  await handleMedia({
    repoRoot,
    storageScope: createStorageScope(DESIGNER, { repoRoot }),
    req,
    res,
    url: new URL('http://decks.example.test/api/media/confirm'),
    authedUser: DESIGNER,
  });
  assert.equal(res.statusCode, 400);
  assert.ok(!JSON.stringify(res.json).includes('exists'));
});
