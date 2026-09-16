/**
 * The theme travels in the `.deck` bundle (B250, D90).
 *
 * Two organizations in one fake database stand in for two instances: the
 * sender owns a database theme, the receiver has never seen it. Pins:
 *
 *   - export: `theme.json` is the record without ids, its logo rides as a
 *     content-addressed asset, curated fonts as bytes with their faces named,
 *     a managed font by name with a `fontsNotIncluded` reason; a file theme
 *     carries no `theme.json`;
 *   - import, the three paths: `canManage` + `install=theme` installs it and the
 *     deck renders with it; `canManage` without the flag, or the flag without
 *     `canManage`, lands on the organization default and says `bundledTheme`;
 *   - dedup: a second import reuses the installed theme, a taken slug gets a
 *     suffix and never an overwrite, a same-instance import lands where it came
 *     from;
 *   - fonts: an unknown managed family falls back and is reported, a family the
 *     receiver has by name is bound to it;
 *   - reading: an unknown bundleVersion, a tampered theme and an unknown
 *     `install` value are refused.
 *
 * Run with: node --test tests/deck-bundle-theme.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { testScope, otherOrganizationScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const SENDER = process.env.DEFAULT_ORGANIZATION_ID;
const RECEIVER = '00000000-0000-0000-0000-0000000000bb';
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createTheme, listThemes, getThemeRecord } =
  await import('../server/storage/themes.js');
const { createFontFamily } = await import('../server/storage/font-families.js');
const { getDefaultThemeId } = await import('../server/storage/settings.js');
const { loadThemeAssets, clearCustomThemeCache } =
  await import('../server/utils/themes.js');
const { curatedFontFaces } = await import('../shared/theme-fonts.js');

let tmpUploads;
let repoRoot;
let buildDeckBundle;
let readDeckBundle;
let handlePresentationsImportDeck;

const LOGO = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const PNG_SLIDE = Buffer.from('89504e470d0a1a0a0000000d49484452AAAA', 'hex');

const senderScope = () => testScope(null, { actorEmail: OWNER });
const receiverScope = () => otherOrganizationScope(null, RECEIVER);
const designer = { email: OWNER, isDesigner: true };
const member = { email: 'member@example.com' };

test.before(async () => {
  tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-theme-up-'));
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-theme-repo-'));
  process.env.UPLOADS_DIR = tmpUploads;
  fs.writeFileSync(path.join(tmpUploads, 'logo.svg'), LOGO);
  fs.writeFileSync(path.join(tmpUploads, 'slide.png'), PNG_SLIDE);

  // Vendor Inter in the temp repo the way postinstall does: one file per
  // weight × subset, identical bytes across weights (a variable family).
  for (const face of curatedFontFaces('Inter')) {
    const abs = path.join(repoRoot, face.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `wOF2 inter ${face.subset}`);
  }

  __setTestDb(
    createFakeDb({
      organizations: [
        { id: SENDER, name: 'Sender', slug: 'sender' },
        { id: RECEIVER, name: 'Receiver', slug: 'receiver' },
      ],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
  ({ buildDeckBundle, readDeckBundle } =
    await import('../server/export/deck-bundle.js'));
  ({ handlePresentationsImportDeck } =
    await import('../server/routes/api/presentations/import-deck.js'));
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
  for (const dir of [tmpUploads, repoRoot]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let slugCounter = 0;
/** A sender theme with a logo, a curated heading font and a config. */
async function senderTheme(overrides = {}) {
  slugCounter += 1;
  const result = await createTheme(senderScope(), {
    label: 'Brand',
    slug: `brand-src-${slugCounter}`,
    logoUrl: '/uploads/logo.svg',
    colors: { primary: '#ff0055', background: '#101010' },
    fonts: { heading: 'Inter', body: 'Inter' },
    config: {
      surfaces: { radius: 'round' },
      logos: { dark: '/uploads/logo.svg' },
    },
    ...overrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.theme;
}

const deckOn = (themeId) => ({
  title: 'Themed deck',
  theme: themeId,
  slides: [
    {
      id: '1',
      type: 'image-slide',
      content: { image: '/uploads/slide.png', alt: 'A' },
    },
  ],
});

function fakeReq(buf) {
  return (async function* () {
    yield buf;
  })();
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

async function importInto(
  scope,
  buf,
  { install = null, user = designer } = {},
) {
  const res = fakeRes();
  const url = new URL('http://x/api/presentations/import/deck');
  if (install) url.searchParams.set('install', install);
  await handlePresentationsImportDeck({
    repoRoot,
    storageScope: { ...scope, actorEmail: user.email },
    req: fakeReq(buf),
    res,
    url,
    authedUser: user,
  });
  return { res, body: res.body ? JSON.parse(res.body) : null };
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function uploadedBytes(ref) {
  return fs.readFileSync(
    path.join(tmpUploads, ref.replace(/^\/uploads\//, '')),
  );
}

function countUploadsWith(bytes) {
  return fs
    .readdirSync(tmpUploads)
    .filter((f) => fs.readFileSync(path.join(tmpUploads, f)).equals(bytes))
    .length;
}

test('export: theme.json is the record without ids, fonts by class', async () => {
  const family = await createFontFamily(senderScope(), {
    name: 'Brand Sans',
    source: 'adobe',
  });
  assert.equal(family.ok, true);
  const theme = await senderTheme({
    fonts: {
      heading: 'Inter',
      body: 'Brand Sans',
      bodyFamilyId: family.fontFamily.id,
    },
  });
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));
  const { manifest, theme: carried, assets } = await readDeckBundle(bundle);

  assert.equal(manifest.bundleVersion, 3);
  assert.equal(manifest.theme.ref, 'theme.json');
  assert.deepEqual(Object.keys(carried).sort(), [
    'colors',
    'config',
    'fonts',
    'label',
    'logoSmallUrl',
    'logoUrl',
    'slug',
  ]);
  assert.deepEqual(carried.fonts, { heading: 'Inter', body: 'Brand Sans' });
  assert.ok(!JSON.stringify(carried).includes(theme.id), 'no theme id');
  assert.ok(!JSON.stringify(carried).includes('/uploads/'), 'no upload refs');

  // The logo is one content-addressed asset, named from both places.
  const logoRef = `assets/${sha(LOGO)}.svg`;
  assert.equal(carried.logoUrl, logoRef);
  assert.equal(carried.config.logos.dark, logoRef);
  assert.ok(assets.get(logoRef).equals(LOGO));

  // Curated Inter: four weights share one file per subset.
  const fontAssets = manifest.assets.filter((a) => a.fontFaces);
  assert.equal(fontAssets.length, 2, 'one asset per distinct file');
  for (const asset of fontAssets) {
    assert.equal(asset.mime, 'font/woff2');
    assert.equal(asset.sources, undefined);
    assert.deepEqual(
      asset.fontFaces.map((f) => f.weight),
      [400, 500, 600, 700],
    );
    assert.ok(asset.fontFaces.every((f) => f.family === 'Inter'));
  }
  assert.deepEqual(fontAssets.map((a) => a.fontFaces[0].subset).sort(), [
    'latin',
    'latin-ext',
  ]);

  assert.deepEqual(manifest.fontsNotIncluded, [
    { family: 'Brand Sans', role: 'body', source: 'adobe', reason: 'licensed' },
  ]);
});

test('export: a file theme travels by id, without theme.json', async () => {
  const bundle = await buildDeckBundle(repoRoot, deckOn('default'));
  const { manifest, deck, theme } = await readDeckBundle(bundle);
  assert.equal(manifest.theme, undefined);
  assert.equal(theme, null);
  assert.equal(deck.theme, 'default');
  const zip = await JSZip.loadAsync(bundle);
  assert.equal(zip.file('theme.json'), null);
});

test('import with canManage + install=theme installs it and renders with it', async () => {
  const theme = await senderTheme();
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));

  const { res, body } = await importInto(receiverScope(), bundle, {
    install: 'theme',
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(body.bundledTheme.status, 'installed');
  assert.equal(body.theme, body.bundledTheme.themeId);

  const installed = await getThemeRecord(receiverScope(), body.theme);
  assert.ok(installed, 'the theme lives in the receiving organization');
  assert.notEqual(installed.id, theme.id);
  assert.ok(uploadedBytes(installed.logoUrl).equals(LOGO), 'logo bytes kept');
  assert.ok(uploadedBytes(installed.config.logos.dark).equals(LOGO));

  // The render config the receiver builds matches the sender's, logo paths
  // aside (same bytes, another upload name).
  clearCustomThemeCache();
  const sent = await loadThemeAssets(repoRoot, theme.id, senderScope());
  const got = await loadThemeAssets(repoRoot, body.theme, receiverScope());
  const withoutLogos = (t) =>
    JSON.parse(
      JSON.stringify({ cssVars: t.cssVars, embedFonts: t.embedFonts }),
    );
  const sentVars = withoutLogos(sent);
  const gotVars = withoutLogos(got);
  delete sentVars.cssVars['--t-logo-url'];
  delete gotVars.cssVars['--t-logo-url'];
  assert.deepEqual(gotVars, sentVars);
  assert.equal(got.cssVars['--t-radius'], '28px', 'config travelled');
});

test('a second import of the same bundle makes no second theme', async () => {
  // A real raster logo: re-encoding it on import would change its hash, and
  // the installed theme would never be recognised again.
  const sharp = (await import('sharp')).default;
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#ff0055' },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  fs.writeFileSync(path.join(tmpUploads, 'raster-logo.png'), png);
  const theme = await senderTheme({
    label: 'Twice',
    logoUrl: '/uploads/raster-logo.png',
  });
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));
  const first = await importInto(receiverScope(), bundle, { install: 'theme' });
  const before = (await listThemes(receiverScope())).length;

  const second = await importInto(receiverScope(), bundle, {
    install: 'theme',
  });
  assert.equal(second.body.bundledTheme.status, 'existing');
  assert.equal(second.body.theme, first.body.theme);
  const installed = await getThemeRecord(receiverScope(), first.body.theme);
  assert.ok(uploadedBytes(installed.logoUrl).equals(png), 'written verbatim');
  assert.equal((await listThemes(receiverScope())).length, before);
});

test('canManage without install lands on the default and names the theme', async () => {
  const logo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" id="x"/>');
  fs.writeFileSync(path.join(tmpUploads, 'only-theme.svg'), logo);
  const theme = await senderTheme({
    label: 'Not asked',
    logoUrl: '/uploads/only-theme.svg',
    config: {},
  });
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));
  const before = (await listThemes(receiverScope())).length;
  const logoCopies = countUploadsWith(logo);

  const { res, body } = await importInto(receiverScope(), bundle);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(body.bundledTheme, {
    slug: theme.slug,
    label: 'Not asked',
    status: 'not-installed',
    reason: 'install-not-requested',
  });
  assert.equal(body.theme, await getDefaultThemeId(receiverScope()));
  assert.equal((await listThemes(receiverScope())).length, before);
  assert.equal(countUploadsWith(logo), logoCopies, 'no logo written');
});

test('install without canManage lands on the default', async () => {
  const theme = await senderTheme({ label: 'Not permitted' });
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));
  const before = (await listThemes(receiverScope())).length;

  const { res, body } = await importInto(receiverScope(), bundle, {
    install: 'theme',
    user: member,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(body.bundledTheme.status, 'not-installed');
  assert.equal(body.bundledTheme.reason, 'not-permitted');
  assert.equal(body.theme, await getDefaultThemeId(receiverScope()));
  assert.equal((await listThemes(receiverScope())).length, before);
});

test('a taken slug gets a suffix, never an overwrite', async () => {
  const theme = await senderTheme({ label: 'Clash', slug: 'clash' });
  const squatter = await createTheme(receiverScope(), {
    label: 'Something else',
    slug: 'clash',
    colors: { primary: '#00ff00' },
  });
  assert.equal(squatter.ok, true);
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));

  const first = await importInto(receiverScope(), bundle, {
    install: 'theme',
  });
  assert.equal(first.body.bundledTheme.status, 'installed');
  const installed = await getThemeRecord(receiverScope(), first.body.theme);
  assert.equal(installed.slug, 'clash-2');
  const kept = await getThemeRecord(receiverScope(), squatter.theme.id);
  assert.equal(kept.label, 'Something else', 'the existing theme is untouched');

  const again = await importInto(receiverScope(), bundle, {
    install: 'theme',
  });
  assert.equal(
    again.body.bundledTheme.status,
    'existing',
    'slug is no content',
  );
  assert.equal(again.body.theme, first.body.theme);
});

test('a same-instance import lands on the theme it came from', async () => {
  const theme = await senderTheme({ label: 'Home' });
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));
  const { body } = await importInto(testScope(), bundle, { user: member });
  assert.equal(body.bundledTheme.status, 'existing');
  assert.equal(body.theme, theme.id);
});

test('fonts: a missing managed family falls back and is reported; a named one binds', async () => {
  const family = await createFontFamily(senderScope(), {
    name: 'House Serif',
    source: 'upload',
  });
  const theme = await senderTheme({
    label: 'Fonts',
    fonts: {
      heading: 'House Serif',
      headingFamilyId: family.fontFamily.id,
      body: 'Inter',
    },
  });
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));

  const missing = await importInto(receiverScope(), bundle, {
    install: 'theme',
  });
  assert.equal(missing.body.bundledTheme.status, 'installed');
  assert.deepEqual(missing.body.bundledTheme.fontsMissing, ['House Serif']);
  const fallback = await getThemeRecord(receiverScope(), missing.body.theme);
  assert.equal(fallback.fonts.heading, 'Inter');
  assert.equal(fallback.fonts.headingFamilyId, undefined);

  // Once the receiving organization has the family, the same bundle installs
  // bound to it — a different theme here than the fallback one.
  const own = await createFontFamily(receiverScope(), {
    name: 'House Serif',
    source: 'adobe',
  });
  const bound = await importInto(receiverScope(), bundle, {
    install: 'theme',
  });
  assert.equal(bound.body.bundledTheme.status, 'installed');
  assert.equal(bound.body.bundledTheme.fontsMissing, undefined);
  const record = await getThemeRecord(receiverScope(), bound.body.theme);
  assert.equal(record.fonts.heading, 'House Serif');
  assert.equal(record.fonts.headingFamilyId, own.fontFamily.id);
  assert.equal(record.slug, `${theme.slug}-2`);
});

test('an unknown install value is refused', async () => {
  const bundle = await buildDeckBundle(repoRoot, deckOn('default'));
  const { res, body } = await importInto(receiverScope(), bundle, {
    install: 'theme,fonts',
  });
  assert.equal(res.statusCode, 400);
  assert.match(body.message, /install=fonts/);
});

test('reading refuses an unknown bundleVersion and a tampered theme', async () => {
  const theme = await senderTheme({ label: 'Tamper' });
  const bundle = await buildDeckBundle(repoRoot, deckOn(theme.id));

  const future = await JSZip.loadAsync(bundle);
  const manifest = JSON.parse(
    await future.file('manifest.json').async('string'),
  );
  future.file(
    'manifest.json',
    JSON.stringify({ ...manifest, bundleVersion: 4 }),
  );
  await assert.rejects(
    readDeckBundle(await future.generateAsync({ type: 'nodebuffer' })),
    /bundleVersion 4/,
  );

  const tampered = await JSZip.loadAsync(bundle);
  tampered.file('theme.json', JSON.stringify({ label: 'Evil' }));
  await assert.rejects(
    readDeckBundle(await tampered.generateAsync({ type: 'nodebuffer' })),
    /theme failed integrity/,
  );
});

test('a version-1 bundle still reads', async () => {
  const bundle = await buildDeckBundle(repoRoot, deckOn('default'));
  const zip = await JSZip.loadAsync(bundle);
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  zip.file('manifest.json', JSON.stringify({ ...manifest, bundleVersion: 1 }));
  const read = await readDeckBundle(
    await zip.generateAsync({ type: 'nodebuffer' }),
  );
  assert.equal(read.manifest.bundleVersion, 1);
  assert.equal(read.theme, null);
});
