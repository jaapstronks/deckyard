/**
 * The two exports walk one asset collector (B252).
 *
 * Deckyard has two exports that enumerate a deck's images, and until this test
 * they answered the question with two different pieces of code:
 *
 *  - the `.deck` bundle (server/export/deck-bundle.js) via `collectAssetRefs`,
 *    a deep, key-agnostic walk for `/uploads/…` strings;
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
 * ask different questions of it, and that difference is deliberate: a bundle
 * must be portable, so it takes only the uploads it can content-address; a
 * backup is of *this* installation, so it takes every path this install serves
 * (a theme's `backgroundPresets` live under `/custom/…` and are baked into
 * `slideBgImage`). The two sets are one subset relation, not two walks.
 *
 * The behaviour of each collector is pinned in tests/deck-assets.test.js; this
 * file pins the seam — that bulk-export reaches for the shared collector and
 * grows no second walker of its own.
 *
 * Run with: node --test tests/export-asset-walkers.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectAssetRefs,
  collectServedAssetRefs,
  isServedAssetRef,
  isUploadRef,
} from '../shared/slide-types/deck-assets.js';
import { SHARED_PUBLIC_DIRS } from '../server/config/paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const bulkExportSrc = fs.readFileSync(
  path.join(repoRoot, 'server/export/bulk-export.js'),
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
  assert.match(deckBundleSrc, /collectAssetRefs/);
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
  assert.match(bulkExportSrc, /isServedAssetRef\(urlPath\)/);
  assert.doesNotMatch(bulkExportSrc, /'\/custom\//);
  assert.doesNotMatch(bulkExportSrc, /'\/assets\/'/);
  // Uploads come from the env/sandbox-aware uploads dir, like the .deck bundle,
  // not from a hardcoded server/uploads — under UPLOADS_DIR the old spelling
  // silently backed up nothing.
  assert.match(bulkExportSrc, /uploadsDir\(repoRoot\)/);
  assert.doesNotMatch(bulkExportSrc, /'server',\s*'uploads'/);
});

test('the served-asset class is a named subset of what the server serves', () => {
  // `shared/` cannot import server config, so the prefixes are spelled there
  // too; this pins that spelling to server/config/paths.js in both directions.
  const assetTrees = [
    '/uploads/',
    '/assets/',
    '/custom/assets/',
    '/custom/themes/',
  ];
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
