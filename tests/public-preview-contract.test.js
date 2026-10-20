import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstPublicSlide,
  filterForPublished,
} from '../server/utils/public-output.js';
import {
  pickOgImageUrlFromPresentation,
  publishedPreviewFingerprint,
  safePublishedOgImage,
} from '../server/render/og-image.js';
import { buildStandaloneHtml } from '../server/export/html.js';
import { buildReaderHtml } from '../server/export/reader.js';
import { buildEmbedHtml } from '../server/utils/embed-html/index.js';
import { getOgImageUrl } from '../server/config/branding.js';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import { initializeStorage } from '../server/db/lifecycle.js';
import { brandSeedRow, seedThemeConfig } from './helpers/theme-seed.js';
import { handlePublished } from '../server/routes/static/published.js';
import { buildPublishOgImage } from '../server/services/publish-presentation.js';
import { testScope } from './helpers/storage-scope.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const root = process.cwd();
const slide = (id, visibility = {}) => ({
  id,
  type: 'title-slide',
  content: { title: id, subtitle: '' },
  visibility,
  notes: 'PRIVATE_NOTES',
  _aiReasoning: 'PRIVATE_AI',
  _aiWarnings: ['PRIVATE_AI'],
  _aiAlternatives: ['PRIVATE_AI'],
});
function deck() {
  const slides = [
    slide('PUBLISHED_HIDDEN', { hideInPublished: true }),
    { id: 'live', type: 'follow-invite-slide', content: {} },
    slide('PUBLIC_ALLOWED', { hideFromViewers: true }),
    slide('SHARE_ALLOWED'),
  ];
  return {
    id: 'public-test',
    title: 'Public test',
    lang: 'en',
    theme: 'default',
    slides,
    i18n: {
      versions: {
        en: { slides },
        de: {
          slides: [
            slide('DE_HIDDEN', { hideInPublished: true }),
            slide('DE_ALLOWED'),
          ],
        },
      },
    },
  };
}
function assertPrivateAbsent(bytes) {
  for (const marker of [
    'PRIVATE_NOTES',
    'PRIVATE_AI',
    'PUBLISHED_HIDDEN',
    'DE_HIDDEN',
  ])
    assert.ok(!bytes.includes(marker), marker);
}

test('preview channels choose distinct visibility flags and drop live-only openings', () => {
  const pres = deck();
  assert.equal(
    firstPublicSlide(pres, { channel: 'published' }).id,
    'PUBLIC_ALLOWED',
  );
  assert.equal(
    firstPublicSlide(pres, { channel: 'share' }).id,
    'PUBLISHED_HIDDEN',
  );
  assert.throws(() => firstPublicSlide(pres), /explicit channel/);
  for (const channel of ['share', 'published']) {
    assert.equal(
      firstPublicSlide(
        {
          slides: [
            slide('hidden', { hideInPublished: true, hideFromViewers: true }),
            { type: 'follow-invite-slide' },
          ],
        },
        { channel },
      ),
      null,
    );
    assert.equal(firstPublicSlide({ slides: [] }, { channel }), null);
  }
  const projected = filterForPublished(pres);
  assertPrivateAbsent(JSON.stringify(projected));
  for (const list of [
    projected.slides,
    ...Object.values(projected.i18n.versions).map((version) => version.slides),
  ]) {
    for (const item of list)
      for (const key of [
        'notes',
        '_aiReasoning',
        '_aiAlternatives',
        '_aiWarnings',
      ])
        assert.ok(!Object.hasOwn(item, key), key);
  }
  assert.equal(projected.i18n.versions.de.slides[0].id, 'DE_ALLOWED');
  assert.equal(pres.slides[0].notes, 'PRIVATE_NOTES');
  assert.equal(pres.i18n.versions.en.slides, pres.slides);
});

test('image fallback uses the selected channel, never a hidden opening image', async () => {
  const pres = {
    slides: [
      {
        ...slide('hidden', { hideInPublished: true }),
        type: 'image-slide',
        content: { image: '/uploads/hidden.jpg' },
      },
      {
        ...slide('allowed'),
        type: 'image-slide',
        content: { image: '/uploads/allowed.jpg' },
      },
    ],
  };
  assert.equal(
    pickOgImageUrlFromPresentation(pres, { channel: 'published' }),
    '/uploads/allowed.jpg',
  );
  assert.equal(
    await buildPublishOgImage({
      repoRoot: root,
      storageScope: testScope(root),
      pres,
      publishId: 'abcd1234',
    }),
    '/uploads/allowed.jpg',
  );
});

test('legacy snapshots fail closed; current proof expires on visibility and translation edits', () => {
  const pres = deck();
  pres.published = { ogImageUrl: '/uploads/legacy-secret.png' };
  assert.equal(safePublishedOgImage(pres), getOgImageUrl());
  pres.published.previewFingerprint = publishedPreviewFingerprint(pres);
  assert.equal(safePublishedOgImage(pres), '/uploads/legacy-secret.png');
  assert.equal(
    safePublishedOgImage(pres, '/uploads/other.png'),
    getOgImageUrl(),
  );
  pres.slides[2].visibility.hideInPublished = true;
  assert.equal(safePublishedOgImage(pres), getOgImageUrl());
  pres.published.previewFingerprint = publishedPreviewFingerprint(pres);
  pres.i18n.versions.de.slides[1].content.title = 'changed';
  assert.equal(safePublishedOgImage(pres), getOgImageUrl());
});

test('real public builders omit private bytes across all carried languages', async () => {
  const pres = deck();
  const theme = await seedThemeConfig('brand');
  const outputs = [
    await buildStandaloneHtml(root, pres, { context: 'published', theme }),
    buildReaderHtml(root, pres, { context: 'published' }),
    await buildEmbedHtml(root, pres, { theme }),
  ];
  for (const html of outputs) {
    assertPrivateAbsent(html);
    assert.ok(html.includes('PUBLIC_ALLOWED'));
  }
});

test('published canvas and reader routes reject legacy OG snapshots and filter language output', async () => {
  const pres = deck();
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      themes: [await brandSeedRow()],
      presentations: [
        {
          ...pres,
          organization_id: ORG,
          owner_email: 'owner@example.com',
          visibility: 'organization',
          revision: 1,
          settings: {},
          published: {
            id: 'abcd1234',
            ogImageUrl: '/uploads/LEGACY_SECRET.png',
          },
          created_at: '2026-01-01T00:00:00Z',
          modified_at: '2026-01-01T00:00:00Z',
          trashed_at: null,
        },
      ],
      published_presentations: [
        {
          id: 'abcd1234',
          organization_id: ORG,
          presentation_id: pres.id,
          slug: 'test',
          og_image_url: '/uploads/LEGACY_SECRET.png',
        },
      ],
      app_settings: [{ id: 'singleton', settings: {} }],
    }),
  );
  await initializeStorage(root);
  try {
    for (const suffix of ['', '/reader', '?lang=de']) {
      const url = new URL(`http://example.test/p/abcd1234-test${suffix}`);
      const res = {
        writeHead(status, headers) {
          this.status = status;
          this.headers = headers;
        },
        end(body) {
          this.body = body;
        },
        setHeader() {},
      };
      await handlePublished({
        repoRoot: root,
        req: { method: 'GET', headers: { host: 'example.test' } },
        res,
        url,
        pathname: url.pathname,
      });
      assert.equal(res.status, 200);
      assertPrivateAbsent(res.body);
      assert.ok(!res.body.includes('LEGACY_SECRET'));
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }
  } finally {
    __setTestDb(null);
  }
});

test('actual asset serving refuses known legacy and invalidated generated rasters without deleting uploads', async () => {
  const { createServer } = await import('node:http');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { handlePublishedPreview } =
    await import('../server/routes/static/published-preview.js');
  const { handleStaticFiles } =
    await import('../server/routes/static/static-files.js');
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'public-preview-'));
  const oldName = 'og-abcd1234-00000000-0000-4000-8000-000000000001.png';
  const pres = deck();
  const newName = `og-v2-abcd1234-${publishedPreviewFingerprint(pres).slice(0, 20)}-00000000-0000-4000-8000-000000000002.png`;
  const currentUrl = `/uploads/${newName}`;
  pres.published = {
    id: 'abcd1234',
    ogImageUrl: currentUrl,
    previewFingerprint: publishedPreviewFingerprint(pres),
  };
  const db = createFakeDb({
    organizations: [{ id: ORG }],
    presentations: [
      {
        ...pres,
        organization_id: ORG,
        revision: 1,
        settings: {},
        created_at: '2026-01-01T00:00:00Z',
        modified_at: '2026-01-01T00:00:00Z',
        trashed_at: null,
      },
    ],
    published_presentations: [
      { id: 'abcd1234', presentation_id: pres.id, og_image_url: currentUrl },
    ],
  });
  __setTestDb(db);
  const { getPresentation } =
    await import('../server/storage/presentations/index.js');
  const loaded = await getPresentation(testScope(root), pres.id);
  db.__tables.presentations[0].published.previewFingerprint =
    publishedPreviewFingerprint(loaded);
  await fs.writeFile(path.join(uploadDir, oldName), 'LEGACY_HIDDEN_RASTER');
  await fs.writeFile(path.join(uploadDir, newName), 'CURRENT_SAFE_RASTER');
  await fs.writeFile(path.join(uploadDir, 'og-holiday.png'), 'ORDINARY_UPLOAD');
  const server = createServer(async (req, res) => {
    try {
      const ctx = {
        repoRoot: root,
        req,
        res,
        url: new URL(req.url, 'http://localhost'),
        sharedPublicDirs: [{ urlPrefix: '/uploads/', dir: uploadDir }],
      };
      if (await handlePublishedPreview(ctx)) return;
      if (handleStaticFiles(ctx)) return;
      res.writeHead(404);
      res.end();
    } catch (err) {
      res.writeHead(500);
      res.end(err.message);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of [oldName, oldName.replace('og-', '%6fg-')]) {
      const response = await fetch(`${base}/uploads/${name}`);
      assert.equal(response.status, 404);
      assert.ok(!(await response.text()).includes('LEGACY_HIDDEN_RASTER'));
    }
    const current = await fetch(base + currentUrl);
    assert.equal(current.status, 200);
    assert.equal(current.headers.get('cache-control'), 'no-store');
    assert.equal(await current.text(), 'CURRENT_SAFE_RASTER');
    db.__tables.presentations[0].slides[2].visibility.hideInPublished = true;
    const invalidated = await fetch(base + currentUrl);
    assert.equal(invalidated.status, 404);
    assert.ok(!(await invalidated.text()).includes('CURRENT_SAFE_RASTER'));
    const ordinary = await fetch(`${base}/uploads/og-holiday.png`);
    assert.equal(ordinary.status, 200);
    assert.equal(await ordinary.text(), 'ORDINARY_UPLOAD');
    assert.equal(
      await fs.readFile(path.join(uploadDir, oldName), 'utf8'),
      'LEGACY_HIDDEN_RASTER',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    __setTestDb(null);
    await fs.rm(uploadDir, { recursive: true, force: true });
  }
});

test('public feeds never advertise a legacy or invalidated OG snapshot', async () => {
  const { buildFeed } = await import('../server/utils/rss-feed.js');
  const pres = deck();
  pres.created = '2026-01-01T00:00:00Z';
  pres.published = {
    id: 'abcd1234',
    slug: 'test',
    ogImageUrl: '/uploads/LEGACY_FEED_SECRET.png',
  };
  const feed = () =>
    buildFeed({
      org: { name: 'Test' },
      presentations: [pres],
      baseUrl: 'https://example.test',
      format: 'json',
    });
  assert.ok(!feed().includes('LEGACY_FEED_SECRET'));
  pres.published.previewFingerprint = publishedPreviewFingerprint(pres);
  assert.ok(feed().includes('LEGACY_FEED_SECRET'));
  pres.slides[2].visibility.hideInPublished = true;
  assert.ok(!feed().includes('LEGACY_FEED_SECRET'));
});
