import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapLimit, exportEmbedConcurrency } from '../server/utils/map-limit.js';
import {
  toDataUrlIfLocal,
  embedImgSrcDataUrls,
} from '../server/utils/html-utils.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * Image embedding used to run one fetch/read at a time, which dominated
 * wall-clock on large decks. These tests pin the new bounded-concurrency
 * behaviour and the per-run dedupe cache: order preserved, concurrency
 * bounded, and each unique source resolved at most once.
 */

test('mapLimit preserves order and returns one result per item', async () => {
  const items = [1, 2, 3, 4, 5];
  const out = await mapLimit(items, 2, async (n) => n * 10);
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

test('mapLimit returns empty array for empty input', async () => {
  assert.deepEqual(await mapLimit([], 8, async () => 1), []);
  assert.deepEqual(await mapLimit(null, 8, async () => 1), []);
});

test('mapLimit never exceeds the concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  const work = async () => {
    active += 1;
    peak = Math.max(peak, active);
    // Yield so other workers can start before this one finishes.
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return true;
  };
  await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, work);
  assert.ok(peak <= 4, `peak concurrency ${peak} exceeded limit 4`);
  assert.ok(peak >= 2, `expected real parallelism, peak was ${peak}`);
});

test('mapLimit rejects if a worker throws (Promise.all semantics)', async () => {
  await assert.rejects(
    mapLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});

test('exportEmbedConcurrency defaults to 8 and honours the env override', () => {
  const prev = process.env.EXPORT_EMBED_CONCURRENCY;
  try {
    delete process.env.EXPORT_EMBED_CONCURRENCY;
    assert.equal(exportEmbedConcurrency(), 8);
    process.env.EXPORT_EMBED_CONCURRENCY = '3';
    assert.equal(exportEmbedConcurrency(), 3);
    process.env.EXPORT_EMBED_CONCURRENCY = 'nonsense';
    assert.equal(exportEmbedConcurrency(), 8);
    process.env.EXPORT_EMBED_CONCURRENCY = '0';
    assert.equal(exportEmbedConcurrency(), 8);
  } finally {
    if (prev === undefined) delete process.env.EXPORT_EMBED_CONCURRENCY;
    else process.env.EXPORT_EMBED_CONCURRENCY = prev;
  }
});

test('toDataUrlIfLocal memoises per-run cache (same promise, one entry)', () => {
  const cache = new Map();
  const src = '/assets/images/logo.svg';
  const p1 = toDataUrlIfLocal(repoRoot, src, { cache });
  const p2 = toDataUrlIfLocal(repoRoot, src, { cache });
  assert.equal(p1, p2, 'repeat calls should return the memoised promise');
  assert.equal(cache.size, 1);
});

test('toDataUrlIfLocal embeds a real local asset as a data URL', async () => {
  const data = await toDataUrlIfLocal(repoRoot, '/assets/images/logo.svg', {});
  assert.ok(data.startsWith('data:image/svg+xml;base64,'), data.slice(0, 40));
});

test('embedImgSrcDataUrls replaces every unique local src once', async () => {
  const html = [
    '<img src="/assets/images/logo.svg" />',
    '<img src="/assets/images/deckyard-mark.svg" />',
    '<img src="/assets/images/logo.svg" />', // duplicate of the first
  ].join('\n');
  const cache = new Map();
  const out = await embedImgSrcDataUrls(repoRoot, html, {
    includeClient: true,
    cache,
  });
  assert.ok(!out.includes('src="/assets/images/logo.svg"'), 'logo not embedded');
  assert.ok(
    !out.includes('src="/assets/images/deckyard-mark.svg"'),
    'mark not embedded',
  );
  // Both occurrences of the duplicate src were replaced.
  assert.equal(out.match(/data:image\/svg\+xml;base64,/g).length, 3);
  // Two unique sources → two cache entries (the duplicate reused the memo).
  assert.equal(cache.size, 2);
});
