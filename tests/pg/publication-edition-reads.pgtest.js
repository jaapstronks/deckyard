/**
 * The public read path of a publication edition, against real PostgreSQL and
 * real renderer bundles. One block per acceptance line of the edition read
 * path (`docs/reference/publication-editions.md` § Public read path):
 *
 *   1. Canvas, reader, manifest, package and preview image of an old
 *      edition stay byte-identical after the deck, its theme record, the
 *      installation default, the slide-type code and the upload change or
 *      disappear; the new edition shows every one of those changes.
 *   2. The canvas address comes from the edition record, not the input.
 *   3. An unknown edition is a 404 and never falls back to the deck.
 *   4. Revocation answers 410 on every subresource, also for a view that was
 *      cached, and leaves the other editions served.
 *   5. A render failure is an error, not the current renderer.
 *   6. The downloaded packages verify offline: valid bytes, corruption and a
 *      missing chain link are reported apart.
 *
 * Rendering runs each bundle in a separate process from its own verified
 * store (`tests/helpers/renderer-bundle-process.js`): the bytes the operator
 * runner would execute, without the runner's OS boundary.
 *
 * Run with: DATABASE_URL=postgres://…/deckyard_pg_tests npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'edition-reads-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.MEDIA_STORAGE_MODE = 'local';
process.env.EXPORT_IMAGE_COMPRESSION = 'false';
delete process.env.SANDBOX_MODE;
delete process.env.DEFAULT_THEME;

const repoRoot = process.cwd();
const { __setTestDb } = await import('../../server/db/client.js');
const { openTestDb, closeTestDb, installFacadeStorage, pgDescribe, truncate } =
  await import('./helpers/harness.js');
const { seedDefaultOrganization, seedPresentation } =
  await import('./helpers/seed.js');
const { initializeMediaProvider } = await import('../../server/media/index.js');
const { buildRendererBundle } =
  await import('../../scripts/build-renderer-bundle.js');
const { openRendererBundle, RendererBundleError, RENDERER_BUNDLE_ERRORS } =
  await import('../../server/render/renderer-bundle/index.js');
const { renderTrustedEditionForProof } =
  await import('../helpers/renderer-bundle-process.js');
const { publishEdition } =
  await import('../../server/services/publish-edition.js');
const { __setEditionRendererForTests, clearEditionCaches } =
  await import('../../server/services/public-edition.js');
const { getEdition, revokeEdition } =
  await import('../../server/storage/editions.js');
const { getPresentation, updatePresentation } =
  await import('../../server/storage/presentations/index.js');
const { handleEditions } =
  await import('../../server/routes/static/edition.js');
const { readEditionPackage, verifyEditionPackages } =
  await import('../../server/export/edition-package.js');
const { initializeThemeSeeds } =
  await import('../../server/utils/theme-seeds.js');

const ORIGIN = 'https://decks.example.test';
const PHOTO_V1 = Buffer.from('edition-reads-photo-one');
const PHOTO_V2 = Buffer.from('edition-reads-photo-two');
const ORG_B = '00000000-0000-0000-0000-0000000000b4';

const slidesFor = (lang) => [
  {
    id: 's1',
    type: 'title-slide',
    content: {
      title: lang === 'en' ? 'Opening EN' : 'Opening NL',
      subheading: `Sub ${lang}`,
    },
    notes: 'Private speaker note',
  },
  {
    id: 's2',
    type: 'image-slide',
    content: {
      title: 'Photo',
      image: '/uploads/photo-reads.png',
      alt: 'A photo',
    },
  },
];
const i18n = () => ({
  active: 'nl',
  dominant: 'nl',
  versions: {
    nl: { title: 'Deck NL', slides: slidesFor('nl') },
    'en-GB': { title: 'Deck EN', slides: slidesFor('en') },
  },
});

/** Drive one GET through the edition routes, with an optional Host header. */
async function get(pathname, { host } = {}) {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers || {});
      return this;
    },
    end(payload) {
      if (this.statusCode === null) this.statusCode = 200;
      this.body = payload == null ? Buffer.alloc(0) : Buffer.from(payload);
      return this;
    },
  };
  const url = new URL(`${ORIGIN}${pathname}`);
  const handled = await handleEditions({
    repoRoot,
    req: {
      method: 'GET',
      headers: { host: host || url.host, 'x-forwarded-proto': 'https' },
    },
    res,
    url,
  });
  if (!handled) return { statusCode: null, headers: {}, body: null };
  return res;
}

const SUBRESOURCES = [
  '',
  '?lang=en',
  '/reader',
  '/reader?lang=en',
  '/manifest.json',
  '/edition.zip',
  '/og',
];

pgDescribe('publication edition reads (PostgreSQL)', () => {
  let db, orgA, deck, scopeA, identity, storeA, storeB, renders;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await initializeMediaProvider(repoRoot);
    await fs.mkdir(process.env.UPLOADS_DIR, { recursive: true });

    // Renderer A: this checkout. Renderer B: the same tree with the title
    // slide's render code changed, built the way an operator builds a release.
    storeA = path.join(tmp, 'store-a');
    storeB = path.join(tmp, 'store-b');
    const a = await buildRendererBundle({ storeDir: storeA });
    const sourceB = path.join(tmp, 'source-b');
    await fs.cp(path.join(storeA, a.rendererHash, 'files'), sourceB, {
      recursive: true,
    });
    const render = path.join(
      sourceB,
      'shared/slide-types/types/title-slide/render.js',
    );
    const code = await fs.readFile(render, 'utf8');
    assert.ok(code.includes('<p class="tsu-subtitle"'));
    await fs.writeFile(
      render,
      code.replace(
        '<p class="tsu-subtitle"',
        '<p class="tsu-subtitle typecode-b"',
      ),
    );
    await buildRendererBundle({ storeDir: storeB, sourceRoot: sourceB });
  });
  after(async () => {
    __setEditionRendererForTests(null);
    await closeTestDb(db);
    await fs.rm(tmp, { recursive: true, force: true });
  });
  beforeEach(async () => {
    __setTestDb(db);
    delete process.env.DEFAULT_THEME;
    await truncate(db, 'organizations');
    await fs.writeFile(
      path.join(process.env.UPLOADS_DIR, 'photo-reads.png'),
      PHOTO_V1,
    );
    orgA = await seedDefaultOrganization(db);
    await initializeThemeSeeds();
    await db
      .insertInto('organizations')
      .values({ id: ORG_B, name: 'Org B', slug: 'org-b' })
      .execute();
    const { id: userId } = await db
      .insertInto('users')
      .values({ organization_id: orgA, email: 'author@example.com' })
      .returning('id')
      .executeTakeFirstOrThrow();
    deck = await seedPresentation(db, {
      title: 'Deck NL',
      slides: slidesFor('nl'),
      i18n: i18n(),
    });
    scopeA = { repoRoot, organizationId: orgA };
    identity = {
      actor: { id: userId, email: 'author@example.com', unrestricted: true },
    };
    renders = 0;
    __setEditionRendererForTests(async (hash, input) => {
      renders++;
      for (const store of [storeA, storeB]) {
        const bundle = await openRendererBundle(store, hash).catch(() => null);
        if (bundle) return renderTrustedEditionForProof(bundle, input);
      }
      throw new RendererBundleError(
        RENDERER_BUNDLE_ERRORS.UNKNOWN,
        `no bundle ${hash}`,
      );
    });
  });

  const publish = async (key, rendererStore = storeA) =>
    publishEdition(
      scopeA,
      identity,
      {
        presentationId: deck,
        expectedRevision: Number(
          (await getPresentation(scopeA, deck)).revision,
        ),
        idempotencyKey: key,
      },
      { rendererStore },
    );

  /** Every public byte of one edition, rendered afresh from storage. */
  async function snapshot(publicationId, version) {
    clearEditionCaches();
    const out = {};
    for (const sub of SUBRESOURCES) {
      const res = await get(`/p/${publicationId}/${version}${sub}`);
      assert.equal(res.statusCode, 200, `${sub || 'canvas'} answers 200`);
      out[sub] = res.body;
    }
    return out;
  }

  it('keeps an old edition identical through every change, and shows them in the next', async () => {
    const v1 = (await publish('v1')).edition;
    const before1 = await snapshot(v1.publicationId, 1);
    const canvas = before1[''].toString('utf8');
    assert.ok(canvas.includes('Opening NL'));
    assert.ok(before1['?lang=en'].toString('utf8').includes('Opening EN'));
    assert.ok(!canvas.includes('Private speaker note'));
    assert.ok(!canvas.includes('typecode-b'));
    assert.deepEqual(before1['/og'], PHOTO_V1, 'og is the edition photo');

    // The deck, its slides and both languages.
    const edited = i18n();
    edited.versions.nl.slides[0].content.title = 'Rewritten NL';
    edited.versions['en-GB'].slides[0].content.title = 'Rewritten EN';
    await updatePresentation(
      scopeA,
      deck,
      { title: 'Deck NL 2', slides: edited.versions.nl.slides, i18n: edited },
      {},
    );
    // The theme record the edition was published with, then the
    // installation default the deck's `default` theme resolves to.
    await db.updateTable('themes').set({ label: 'Renamed theme' }).execute();
    process.env.DEFAULT_THEME = 'midnight';
    // The upload: replaced bytes under the same name.
    await fs.writeFile(
      path.join(process.env.UPLOADS_DIR, 'photo-reads.png'),
      PHOTO_V2,
    );

    // v2 is published with renderer B: new type code.
    const v2 = (await publish('v2', storeB)).edition;
    assert.equal(v2.publicationId, v1.publicationId);
    assert.equal(v2.version, 2);
    assert.notEqual(v2.rendererHash, v1.rendererHash);

    // The upload disappears altogether.
    await fs.rm(path.join(process.env.UPLOADS_DIR, 'photo-reads.png'));

    const after1 = await snapshot(v1.publicationId, 1);
    for (const sub of SUBRESOURCES) {
      if (sub === '/edition.zip') continue; // compared by content below
      assert.ok(
        after1[sub].equals(before1[sub]),
        `v1${sub || ' canvas'} is byte-identical`,
      );
    }
    const zipFiles = async (zip) => readEditionPackage(zip);
    assert.deepEqual(
      await zipFiles(after1['/edition.zip']),
      await zipFiles(before1['/edition.zip']),
    );

    const after2 = await snapshot(v1.publicationId, 2);
    const canvas2 = after2[''].toString('utf8');
    assert.ok(canvas2.includes('Rewritten NL'), 'v2 shows the deck edit');
    assert.ok(after2['?lang=en'].toString('utf8').includes('Rewritten EN'));
    assert.ok(canvas2.includes('typecode-b'), 'v2 renders with renderer B');
    assert.deepEqual(after2['/og'], PHOTO_V2, 'v2 shows the new upload');
    const m1 = JSON.parse(after1['/manifest.json']);
    const m2 = JSON.parse(after2['/manifest.json']);
    assert.notEqual(m1.content.sha256, m2.content.sha256);
    assert.notEqual(m1.theme.sha256, m2.theme.sha256, 'v2 has the new theme');
  });

  it('takes the canvas address from the edition record, not from the input', async () => {
    const v1 = (await publish('addr')).edition;
    const stored = await getEdition(scopeA, v1.publicationId, 1);
    assert.equal(
      JSON.parse(stored.inputBytes.toString('utf8')).canonicalUrl,
      '',
    );
    const base = `${ORIGIN}/p/${v1.publicationId}/1`;
    const canvas = (
      await get(`/p/${v1.publicationId}/1?lang=en`)
    ).body.toString();
    assert.ok(
      canvas.includes(`<link rel="canonical" href="${base}?lang=en-GB" />`),
    );
    assert.ok(canvas.includes(`content="${base}/og"`));
    assert.ok(canvas.includes(`href="${base}/reader?lang=en-GB"`));
    const reader = (
      await get(`/p/${v1.publicationId}/1/reader`)
    ).body.toString();
    assert.ok(reader.includes(`href="${base}?lang=nl"`));
  });

  it('builds the address on the configured URL, whatever Host is sent', async () => {
    const v1 = (await publish('host')).edition;
    const base = `${ORIGIN}/p/${v1.publicationId}/1`;
    const before = process.env.APP_URL;
    process.env.APP_URL = ORIGIN;
    try {
      const start = renders;
      const own = (await get(`/p/${v1.publicationId}/1`)).body.toString();
      const forged = (
        await get(`/p/${v1.publicationId}/1`, { host: 'evil.example.test' })
      ).body.toString();
      assert.ok(forged.includes(`<link rel="canonical" href="${base}`));
      assert.ok(!forged.includes('evil.example.test'));
      assert.equal(forged, own);
      assert.equal(
        renders - start,
        1,
        'a foreign Host is the same cache entry',
      );
    } finally {
      if (before === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = before;
    }
  });

  it('answers an unknown edition with 404 and never with the deck', async () => {
    const v1 = (await publish('known')).edition;
    for (const pathname of [
      `/p/${v1.publicationId}/2`,
      `/p/${v1.publicationId}/2/reader`,
      `/p/${v1.publicationId}/99/manifest.json`,
      `/p/${crypto.randomUUID()}/1`,
      `/p/${deck}/1`,
    ]) {
      const res = await get(pathname);
      assert.equal(res.statusCode, 404, pathname);
      assert.ok(!String(res.body).includes('Opening'), pathname);
    }
    assert.equal((await get(`/p/${v1.publicationId}/0`)).statusCode, null);
    assert.equal((await get(`/p/${v1.publicationId}`)).statusCode, null);
  });

  it('revokes every subresource, cached or not, and only that edition', async () => {
    const v1 = (await publish('r1')).edition;
    await updatePresentation(scopeA, deck, { title: 'Next' }, {});
    const v2 = (await publish('r2')).edition;
    clearEditionCaches();
    // Warm the cache for v1.
    assert.equal((await get(`/p/${v1.publicationId}/1`)).statusCode, 200);
    const warm = renders;

    // Organization B cannot revoke it.
    await assert.rejects(
      revokeEdition({ repoRoot, organizationId: ORG_B }, v1.publicationId, 1),
      /not found/i,
    );
    await revokeEdition(scopeA, v1.publicationId, 1, {
      actorUserId: identity.actor.id,
    });
    for (const sub of SUBRESOURCES) {
      const res = await get(`/p/${v1.publicationId}/1${sub}`);
      assert.equal(res.statusCode, 410, `${sub || 'canvas'} is gone`);
      assert.equal(res.headers['Cache-Control'], 'no-store');
      const body = res.body.toString();
      assert.ok(!body.includes('Opening') && !body.includes('Deck NL'), sub);
    }
    assert.equal(renders, warm, 'a revoked edition is never rendered');
    const again = await revokeEdition(scopeA, v1.publicationId, 1);
    assert.ok(again.revokedAt);

    for (const sub of SUBRESOURCES) {
      const res = await get(`/p/${v2.publicationId}/2${sub}`);
      assert.equal(res.statusCode, 200, `v2${sub} still served`);
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }
  });

  it('fails a render it cannot do, without falling back', async () => {
    const v1 = (await publish('fail')).edition;
    __setEditionRendererForTests(async () => {
      throw new RendererBundleError(
        RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
        'runner down',
      );
    });
    const res = await get(`/p/${v1.publicationId}/1`);
    assert.equal(res.statusCode, 503);
    assert.ok(!res.body.toString().includes('Opening'));
    // The manifest and the package do not need a render.
    assert.equal(
      (await get(`/p/${v1.publicationId}/1/manifest.json`)).statusCode,
      200,
    );
  });

  it('serves packages that verify offline, and names corruption and gaps apart', async () => {
    const v1 = (await publish('p1')).edition;
    await updatePresentation(scopeA, deck, { title: 'Next' }, {});
    await publish('p2');
    const pkg = async (v) => ({
      name: `v${v}`,
      ...(await readEditionPackage(
        (await get(`/p/${v1.publicationId}/${v}/edition.zip`)).body,
      )),
    });
    const p1 = await pkg(1);
    const p2 = await pkg(2);

    // The theme embeds fonts: the package names them by hash only (D367).
    const stored = await getEdition(scopeA, v1.publicationId, 1);
    const fontCss = JSON.parse(stored.inputBytes.toString('utf8')).css.fontCss;
    const fonts = [
      ...fontCss.matchAll(/data:[^;]+;base64,([A-Za-z0-9+/=]+)/g),
    ].map((m) => Buffer.from(m[1], 'base64'));
    assert.ok(fonts.length > 0, 'the fixture theme embeds fonts');
    for (const font of fonts) {
      assert.equal(p1.inputBytes.indexOf(font.toString('base64')), -1);
    }

    const both = verifyEditionPackages([p1, p2]);
    assert.equal(both.ok, true);
    assert.equal(both.chain.complete, true);
    for (const p of both.packages) {
      assert.equal(p.valid, true);
      assert.equal(p.inputHashChecked, false);
      assert.ok(p.withheld.length > 0);
    }
    // With the font files the stored input is rebuilt and its hash checked.
    const full = verifyEditionPackages([p1, p2], { fonts });
    assert.equal(full.ok, true);
    assert.ok(full.packages.every((p) => p.valid && p.inputHashChecked));

    const gap = verifyEditionPackages([p2]);
    assert.ok(gap.packages[0].valid, 'the bytes are still valid');
    assert.deepEqual(gap.chain.missing, [
      { version: 1, manifestHash: v1.manifestHash },
    ]);
    assert.equal(gap.chain.mismatched.length, 0);

    const bad = Buffer.from(p2.inputBytes);
    bad[bad.indexOf('Next')] = 'X'.charCodeAt(0);
    const corrupt = verifyEditionPackages([p1, { ...p2, inputBytes: bad }]);
    assert.equal(corrupt.packages[1].valid, false);
    assert.ok(
      corrupt.packages[1].problems.some(
        (p) => p.code === 'content_hash_mismatch',
      ),
    );
    assert.equal(corrupt.chain.complete, true, 'corruption is not a gap');
    const corruptFull = verifyEditionPackages(
      [p1, { ...p2, inputBytes: bad }],
      { fonts },
    );
    assert.ok(
      corruptFull.packages[1].problems.some(
        (p) => p.code === 'input_hash_mismatch',
      ),
    );
  });
});
