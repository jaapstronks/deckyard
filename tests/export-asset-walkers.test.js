/**
 * The two exports walk one asset collector (B252).
 *
 * Deckyard has two exports that enumerate a deck's images, and until this test
 * they answered the question with two different pieces of code:
 *
 *  - the `.deck` bundle (server/export/deck-bundle.js) via
 *    `collectServedAssetRefs`, a deep, key-agnostic walk for served paths;
 *  - the bulk export / backup (server/export/bulk-export.js) via a private
 *    `extractImageUrls`, which checked eight hardcoded field keys.
 *
 * The two drifted, measurably. The key list never learned about
 * `quote-slide`'s four author photos (`authorImage1`, `authorImage2`,
 * `quotes[].authorImage`, `quotes[].authorImage2`), so a backup silently left
 * them out; it also treated `content-slide`'s `actions[].url` — a
 * call-to-action link — as an image to download. A new image field would have
 * joined the first list and not the second.
 *
 * Both now ride the one walk in shared/slide-types/deck-assets.js. They still
 * both take every served path. The bundle content-addresses the bytes and
 * rewrites the refs; the backup preserves the original paths. A theme's
 * `backgroundPresets` also live under `/custom/…`.
 *
 * The behaviour of each collector is pinned in tests/deck-assets.test.js; this
 * file pins the seam — that bulk-export reaches for the shared collector and
 * grows no second walker of its own, and that the render side's embed gate
 * (server/utils/html-utils.js) reads the same predicate instead of a third
 * prefix list (B261).
 *
 * Run with: node --test tests/export-asset-walkers.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectAssetRefs,
  collectServedAssetRefs,
  isServedAssetRef,
  isUploadRef,
} from '../shared/slide-types/deck-assets.js';
import { SHARED_PUBLIC_DIRS } from '../server/config/paths.js';
import { uploadsDir } from '../server/config/storage-paths.js';
import {
  isRenderAssetRef,
  resolveRenderAssetPath,
  toDataUrlIfLocal,
} from '../server/utils/html-utils.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const bulkExportSrc = fs.readFileSync(
  path.join(repoRoot, 'server/export/bulk-export.js'),
  'utf8',
);
const htmlUtilsSrc = fs.readFileSync(
  path.join(repoRoot, 'server/utils/html-utils.js'),
  'utf8',
);
const deckBundleSrc = fs.readFileSync(
  path.join(repoRoot, 'server/export/deck-bundle.js'),
  'utf8',
);

test('bulk export takes its deck refs from the shared collector', () => {
  assert.match(
    bulkExportSrc,
    /import \{[^}]*\bcollectServedAssetRefs\b[^}]*\} from '\.\.\/\.\.\/shared\/slide-types\/deck-assets\.js';/,
  );
  assert.match(bulkExportSrc, /collectServedAssetRefs\(full\)/);
});

test('the .deck bundle takes its refs from the same module', () => {
  assert.match(deckBundleSrc, /collectServedAssetRefs\(deck\)/);
  assert.match(deckBundleSrc, /shared\/slide-types\/deck-assets\.js/);
});

test('bulk export defines no asset walker of its own', () => {
  // The failure this guards against is a helper that re-derives "which fields
  // hold an image" locally — a key list, or a second recursive walk.
  assert.doesNotMatch(bulkExportSrc, /function extractImageUrls/);
  assert.doesNotMatch(bulkExportSrc, /function isImageUrl/);
  assert.doesNotMatch(bulkExportSrc, /'slideBgImage'/);
  assert.doesNotMatch(bulkExportSrc, /'logoSmallUrl'/);
});

test('the bulk-export resolver accepts the class the collector produces', () => {
  // The walker says which strings are assets; the resolver turns them into
  // files. Both must ride one predicate, or a prefix the walker collects can
  // be one the resolver refuses (or the reverse) without any test noticing.
  // Since B509 the class lives in the shared resolver, which gates on
  // `isServedAssetRef`; the prefix-table seam test below pins the rest.
  assert.match(bulkExportSrc, /resolveServedAssetPath\(repoRoot, urlPath\)/);
  assert.doesNotMatch(bulkExportSrc, /'server',\s*'uploads'/);
});

test('the served-asset class is a named subset of what the server serves', () => {
  // `shared/` cannot import server config, so the prefixes are spelled there
  // too; this pins that spelling to server/config/paths.js in both directions.
  const assetTrees = ['/uploads/', '/assets/', '/custom/assets/'];
  const served = SHARED_PUBLIC_DIRS.map((d) => d.urlPrefix);
  for (const prefix of assetTrees) {
    assert.ok(served.includes(prefix), `${prefix} is no longer served`);
  }
  for (const prefix of served) {
    assert.equal(
      isServedAssetRef(`${prefix}x.png`),
      assetTrees.includes(prefix),
      prefix,
    );
  }
});

test('both exports see the same asset set for the same deck', () => {
  // A deck exercising every shape the old key list got wrong: a nested item
  // image, a quote author photo, a theme preset under /custom/, a CTA link and
  // a remote image.
  const deck = {
    slides: [
      { content: { members: [{ image: '/uploads/ann.jpg' }] } },
      { content: { quotes: [{ authorImage: '/uploads/bo.png' }] } },
      { content: { slideBgImage: '/custom/assets/backgrounds/bg1.jpg' } },
      {
        content: {
          actions: [{ url: 'https://example.com/pricing' }],
          image: 'https://cdn.example.com/logo.png',
        },
      },
    ],
  };

  const owned = collectAssetRefs(deck);
  const served = collectServedAssetRefs(deck);

  // The bundle owns the uploads — including the two the old key list missed.
  assert.deepEqual(owned, ['/uploads/ann.jpg', '/uploads/bo.png']);

  // The backup sees those same refs, plus what this install additionally serves.
  assert.deepEqual(
    served.filter((r) => isUploadRef(r)),
    owned,
  );
  assert.deepEqual(
    served.filter((r) => !isUploadRef(r)),
    ['/custom/assets/backgrounds/bg1.jpg'],
  );

  // Neither export claims a remote URL as an asset: it stays a valid URL in the
  // exported JSON, and a link target was never an image to begin with.
  for (const refs of [owned, served]) {
    assert.deepEqual(
      refs.filter((r) => /^https?:/.test(r)),
      [],
    );
  }
});

test('the render embed gate reads the served-asset predicate (B261)', () => {
  // The third spelling of the class lived here: a prefix list, a regex with
  // its own alternation (plus a `custom/themes` branch no root resolved), and
  // a hardcoded `server/uploads` that under UPLOADS_DIR inlined nothing.
  assert.match(htmlUtilsSrc, /isServedAssetRef\(s\) \|\| isIconUrl\(s\)/);
  assert.doesNotMatch(htmlUtilsSrc, /'server',\s*'uploads'/);
  assert.doesNotMatch(htmlUtilsSrc, /uploads\|assets/);
  assert.doesNotMatch(htmlUtilsSrc, /includeClient/);
});

test('the render class is the served-asset class plus the icon SVGs', () => {
  for (const prefix of SHARED_PUBLIC_DIRS.map((d) => d.urlPrefix)) {
    const ref = `${prefix}x.png`;
    assert.equal(isRenderAssetRef(ref), isServedAssetRef(ref), prefix);
  }
  assert.equal(
    isRenderAssetRef('/client/vendor/lucide-icons/activity.svg'),
    true,
  );
  assert.equal(isRenderAssetRef('/client/vendor/lucide-icons/x.js'), false);
  assert.equal(isRenderAssetRef('/custom/themes/acme/bg.jpg'), false);
});

test('every render asset resolves under the directory the server serves it from', () => {
  const served = new Map(SHARED_PUBLIC_DIRS.map((d) => [d.urlPrefix, d.dir]));
  const cases = [
    ['/uploads/pic.png', uploadsDir(repoRoot)],
    ['/assets/images/logo.svg', served.get('/assets/')],
    ['/custom/assets/backgrounds/bg1.jpg', served.get('/custom/assets/')],
    [
      '/client/vendor/lucide-icons/activity.svg',
      path.join(served.get('/client/'), 'vendor', 'lucide-icons'),
    ],
  ];
  for (const [ref, dir] of cases) {
    const abs = resolveRenderAssetPath(repoRoot, ref);
    assert.ok(abs?.startsWith(path.resolve(dir) + path.sep), ref);
  }
  for (const ref of ['/css/x.png', '/shared/x.png', '/client/app.js']) {
    assert.equal(resolveRenderAssetPath(repoRoot, ref), null, ref);
  }
});

test('an upload under UPLOADS_DIR is inlined from there, not from server/uploads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-b261-uploads-'));
  const prev = process.env.UPLOADS_DIR;
  try {
    fs.writeFileSync(path.join(dir, 'moved.png'), Buffer.from('MOVED'));
    process.env.UPLOADS_DIR = dir;
    const out = await toDataUrlIfLocal(repoRoot, '/uploads/moved.png');
    assert.equal(
      out,
      `data:image/png;base64,${Buffer.from('MOVED').toString('base64')}`,
    );
  } finally {
    if (prev === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
