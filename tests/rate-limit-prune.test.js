import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowRequestSync,
  rateLimitBucketCount,
  resetRateLimitBuckets,
} from '../server/utils/rate-limit.js';

/**
 * Security follow-up: the in-memory fallback bucket map must not grow without
 * bound. A stream of unique keys (one per attacker IP/email) used to leak a
 * Map entry forever; idle buckets that have refilled to full should be pruned.
 */

test('idle full buckets are pruned once the map crosses the threshold', () => {
  resetRateLimitBuckets();
  // Each unique key with capacity 1 starts full, consumes its one token, and
  // then immediately refills (refillPerSec 1000 → back to full within a ms).
  // By the time we cross PRUNE_THRESHOLD (10000) they are all full again, so
  // the sweep on the next insert drops the lot.
  const opts = { capacity: 1, refillPerSec: 1000 };
  for (let i = 0; i < 10050; i++) {
    allowRequestSync(`prune-test:${i}`, opts);
  }
  // The map must have been swept rather than accumulating all 10050 keys.
  assert.ok(
    rateLimitBucketCount() < 10000,
    `expected pruning, got ${rateLimitBucketCount()} buckets`
  );
  resetRateLimitBuckets();
});

test('actively-throttled buckets survive pruning', () => {
  resetRateLimitBuckets();
  // A slow-refilling bucket that is depleted stays depleted (and present):
  // capacity 1, refill ~0 → after consuming its token it is not full.
  const depleted = { capacity: 1, refillPerSec: 0.0001 };
  assert.equal(allowRequestSync('throttled:victim', depleted), true);
  assert.equal(allowRequestSync('throttled:victim', depleted), false);

  // Flood the map with fresh full buckets to trigger a sweep.
  const disposable = { capacity: 1, refillPerSec: 1000 };
  for (let i = 0; i < 10050; i++) {
    allowRequestSync(`throttled:flood:${i}`, disposable);
  }

  // The depleted victim must still be throttled — pruning must not have
  // reset it by dropping and recreating it as a fresh (full) bucket.
  assert.equal(allowRequestSync('throttled:victim', depleted), false);
  resetRateLimitBuckets();
});
