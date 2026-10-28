/**
 * `scripts/scan-edition-input-size.js` (activation review A3): the estimate
 * per deck and the summary it reports. The database half is the CLI's; the
 * arithmetic is pinned here so the measurement Jaap runs on production means
 * what the review says it means.
 *
 * Run with: node --test tests/scan-edition-input-size.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EDITION_REQUEST_LIMIT,
  estimateEditionInput,
  summarizeSizes,
} from '../scripts/scan-edition-input-size.js';

const sizes = { '/uploads/a.png': 3000, '/uploads/b.png': 300 };
const assetBytes = async (ref) => sizes[ref] ?? null;

test('an asset counts once, base64-encoded; a hidden slide and its asset do not count', async () => {
  const deck = {
    slides: [
      { id: 's1', type: 'image', content: { image: '/uploads/a.png' } },
      { id: 's2', type: 'image', content: { image: '/uploads/a.png' } },
      {
        id: 's3',
        type: 'image',
        content: { image: '/uploads/b.png' },
        visibility: { hideInPublished: true },
      },
    ],
  };
  const estimate = await estimateEditionInput(deck, assetBytes);
  assert.equal(estimate.assets, 1);
  assert.equal(estimate.assetBytes, 4000);
  assert.equal(estimate.unresolved, 0);
  assert.equal(estimate.bytes, estimate.jsonBytes + 4000);
});

test('assets in a language version count, and unreadable refs are reported', async () => {
  const deck = {
    slides: [],
    i18n: {
      versions: {
        nl: {
          slides: [
            { id: 's1', type: 'image', content: { image: '/uploads/b.png' } },
            {
              id: 's2',
              type: 'image',
              content: { image: '/uploads/gone.png' },
            },
          ],
        },
      },
    },
  };
  const estimate = await estimateEditionInput(deck, assetBytes);
  assert.equal(estimate.assets, 2);
  assert.equal(estimate.assetBytes, 400);
  assert.equal(estimate.unresolved, 1);
});

test('the summary reports max, nearest-rank p95 and the count over 16 MiB', () => {
  const list = Array.from({ length: 20 }, (_, i) => (i + 1) * 1024 * 1024);
  assert.deepEqual(summarizeSizes(list), {
    decks: 20,
    max: 20 * 1024 * 1024,
    p95: 19 * 1024 * 1024,
    overLimit: 4,
    limit: EDITION_REQUEST_LIMIT,
  });
  assert.deepEqual(summarizeSizes([]), {
    decks: 0,
    max: 0,
    p95: 0,
    overLimit: 0,
    limit: EDITION_REQUEST_LIMIT,
  });
});
