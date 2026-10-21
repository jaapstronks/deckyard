/**
 * The one-time sweep of legacy generated previews on a remote origin (B806,
 * `scripts/sweep-published-previews.js`): it lists only names the OG generator
 * minted, keeps the preview a live publication still proves, leaves an object
 * younger than an hour for the next run, and deletes only with --apply.
 *
 * Run with: node --test tests/sweep-published-previews.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  provenPreviewNames,
  sweepPublishedPreviews,
  SWEEP_GRACE_MS,
} from '../scripts/sweep-published-previews.js';
import { publishedPreviewFingerprint } from '../server/render/og-image.js';
import { createFakeDb } from './helpers/fake-db.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const OLD = new Date(NOW - 2 * SWEEP_GRACE_MS);
const uuid = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const LEGACY = `og-abcd1234-${uuid(1)}.png`;
const REPLACED = `og-v2-abcd1234-0123456789abcdef0123-${uuid(2)}.png`;
const PROVEN = `og-v2-abcd1234-0123456789abcdef0123-${uuid(3)}.png`;
const FRESH = `og-v2-abcd1234-0123456789abcdef0123-${uuid(4)}.png`;

function fakeBucket(objects) {
  const deleted = [];
  return {
    deleted,
    async *listObjects(prefix) {
      assert.equal(prefix, 'uploads/');
      yield* objects;
    },
    async deleteFile(key) {
      deleted.push(key);
      return true;
    },
  };
}

const objects = [
  { key: `uploads/2025/03/${LEGACY}`, lastModified: OLD },
  { key: `uploads/2026/10/${REPLACED}`, lastModified: OLD },
  { key: `uploads/2026/10/${PROVEN}`, lastModified: OLD },
  { key: `uploads/2026/10/${FRESH}`, lastModified: new Date(NOW - 1000) },
  { key: `uploads/2026/10/photo-${uuid(5)}.png`, lastModified: OLD },
  { key: `uploads/2026/10/og-header-${uuid(6)}.png`, lastModified: OLD },
  { key: `uploads/2026/10/lib-abcd1234-${uuid(7)}.png`, lastModified: OLD },
];

test('the dry run lists only generated previews nothing proves, and deletes nothing', async () => {
  const bucket = fakeBucket(objects);
  const report = await sweepPublishedPreviews(bucket, new Set([PROVEN]), {
    apply: false,
    now: NOW,
  });
  assert.deepEqual(report.stale, [
    `uploads/2025/03/${LEGACY}`,
    `uploads/2026/10/${REPLACED}`,
  ]);
  assert.deepEqual(bucket.deleted, []);
});

test('--apply deletes exactly the listed previews', async () => {
  const bucket = fakeBucket(objects);
  const report = await sweepPublishedPreviews(bucket, new Set([PROVEN]), {
    apply: true,
    now: NOW,
  });
  assert.deepEqual(bucket.deleted, report.stale);
  assert.deepEqual(report.deleted, report.stale);
  assert.deepEqual(report.failed, []);
});

test('a preview is proven only while its publication still proves it', async () => {
  const deck = {
    id: 'deck-1',
    theme: 'default',
    slides: [{ id: 's1', type: 'title-slide', content: { title: 'Hi' } }],
  };
  const url = `https://cdn.example.com/uploads/2026/10/${PROVEN}`;
  const staleUrl = `https://cdn.example.com/uploads/2026/10/${REPLACED}`;
  const decks = {
    'deck-1': {
      ...deck,
      published: {
        ogImageUrl: url,
        previewFingerprint: publishedPreviewFingerprint(deck),
      },
    },
    'deck-2': {
      ...deck,
      id: 'deck-2',
      published: { ogImageUrl: staleUrl, previewFingerprint: 'stale' },
    },
  };
  const db = createFakeDb({
    published_presentations: [
      { id: 'p1', presentation_id: 'deck-1', og_image_url: url },
      { id: 'p2', presentation_id: 'deck-2', og_image_url: staleUrl },
      { id: 'p3', presentation_id: 'gone', og_image_url: '' },
    ],
  });
  const names = await provenPreviewNames(db, async (id) => decks[id] || null);
  assert.deepEqual([...names], [PROVEN]);
});
