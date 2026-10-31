/**
 * The sweep of the previews generated before editions on a remote origin
 * (B806, T1.5, `scripts/sweep-published-previews.js`): it lists only names the
 * old OG generator minted (no publication proves one any more), leaves an
 * object younger than an hour for the next run, and deletes only with --apply.
 *
 * Run with: node --test tests/sweep-published-previews.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sweepPublishedPreviews,
  SWEEP_GRACE_MS,
} from '../scripts/sweep-published-previews.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const OLD = new Date(NOW - 2 * SWEEP_GRACE_MS);
const uuid = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const LEGACY = `og-abcd1234-${uuid(1)}.png`;
const REPLACED = `og-v2-abcd1234-0123456789abcdef0123-${uuid(2)}.png`;
const LATEST = `og-v2-abcd1234-0123456789abcdef0123-${uuid(3)}.png`;
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
  { key: `uploads/2026/10/${LATEST}`, lastModified: OLD },
  { key: `uploads/2026/10/${FRESH}`, lastModified: new Date(NOW - 1000) },
  { key: `uploads/2026/10/photo-${uuid(5)}.png`, lastModified: OLD },
  { key: `uploads/2026/10/og-header-${uuid(6)}.png`, lastModified: OLD },
  { key: `uploads/2026/10/lib-abcd1234-${uuid(7)}.png`, lastModified: OLD },
];

test('the dry run lists every old generated preview past the grace period, and deletes nothing', async () => {
  const bucket = fakeBucket(objects);
  const report = await sweepPublishedPreviews(bucket, {
    apply: false,
    now: NOW,
  });
  assert.deepEqual(report.stale, [
    `uploads/2025/03/${LEGACY}`,
    `uploads/2026/10/${REPLACED}`,
    `uploads/2026/10/${LATEST}`,
  ]);
  assert.deepEqual(bucket.deleted, []);
});

test('--apply deletes exactly the listed previews', async () => {
  const bucket = fakeBucket(objects);
  const report = await sweepPublishedPreviews(bucket, {
    apply: true,
    now: NOW,
  });
  assert.deepEqual(bucket.deleted, report.stale);
  assert.deepEqual(report.deleted, report.stale);
  assert.deepEqual(report.failed, []);
  assert.equal(report.deleted.length, 3);
});
