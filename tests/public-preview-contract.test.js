import test from 'node:test';
import assert from 'node:assert/strict';
import {
  firstPublicSlide,
  filterForPublished,
} from '../server/utils/public-output.js';
import { buildStandaloneHtml } from '../server/export/html.js';
import { buildReaderHtml } from '../server/export/reader.js';
import { buildEmbedHtml } from '../server/utils/embed-html/index.js';
import { seedThemeConfig } from './helpers/theme-seed.js';

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
  _aiSuggestAfter: { reason: 'PRIVATE_AI' },
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
        '_aiSuggestAfter',
        '_aiWarnings',
      ])
        assert.ok(!Object.hasOwn(item, key), key);
  }
  assert.equal(projected.i18n.versions.de.slides[0].id, 'DE_ALLOWED');
  assert.equal(pres.slides[0].notes, 'PRIVATE_NOTES');
  assert.equal(pres.i18n.versions.en.slides, pres.slides);
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

test('the previews generated before editions are never served as uploads', async () => {
  const { createServer } = await import('node:http');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { handleStaticFiles } =
    await import('../server/routes/static/static-files.js');
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'public-preview-'));
  const oldName = 'og-abcd1234-00000000-0000-4000-8000-000000000001.png';
  const v2Name =
    'og-v2-abcd1234-0123456789abcdef0123-00000000-0000-4000-8000-000000000002.png';
  await fs.writeFile(path.join(uploadDir, oldName), 'LEGACY_HIDDEN_RASTER');
  await fs.writeFile(path.join(uploadDir, v2Name), 'V2_HIDDEN_RASTER');
  await fs.writeFile(path.join(uploadDir, 'og-holiday.png'), 'ORDINARY_UPLOAD');
  const server = createServer(async (req, res) => {
    const ctx = {
      repoRoot: root,
      req,
      res,
      url: new URL(req.url, 'http://localhost'),
      sharedPublicDirs: [{ urlPrefix: '/uploads/', dir: uploadDir }],
    };
    if (await handleStaticFiles(ctx)) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of [oldName, oldName.replace('og-', '%6fg-'), v2Name]) {
      const response = await fetch(`${base}/uploads/${name}`);
      assert.equal(response.status, 404);
      assert.ok(!(await response.text()).includes('HIDDEN_RASTER'));
    }
    const ordinary = await fetch(`${base}/uploads/og-holiday.png`);
    assert.equal(ordinary.status, 200);
    assert.equal(await ordinary.text(), 'ORDINARY_UPLOAD');
    assert.equal(
      await fs.readFile(path.join(uploadDir, oldName), 'utf8'),
      'LEGACY_HIDDEN_RASTER',
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(uploadDir, { recursive: true, force: true });
  }
});
