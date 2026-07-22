import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowRequest,
  resetRateLimitBuckets,
} from '../server/utils/rate-limit.js';

/**
 * Regression: `allowRequest` used to return a bare boolean on the Redis-free
 * path and a Promise once Redis was configured. Every route guard was written
 * as `if (!allowRequest(...))`, so the moment REDIS_URL was set the result
 * became a (truthy) Promise, `!Promise` was always false, and the limiter never
 * tripped — leaving the public, unauthenticated endpoints (leads, analytics)
 * wide open.
 *
 * The fix makes `allowRequest` ALWAYS return a Promise, forcing callers to
 * await. These tests lock that contract and prove the awaited limiter blocks.
 */

test('allowRequest always returns a Promise (so `!allowRequest(...)` never gates)', () => {
  resetRateLimitBuckets();
  const result = allowRequest('await-contract:x', { capacity: 1, refillPerSec: 1000 });
  assert.ok(
    result && typeof result.then === 'function',
    'allowRequest must return a Promise regardless of Redis config'
  );
  // This is the exact footgun the fix removes: the unawaited value is a Promise,
  // which is truthy, so the old `if (!allowRequest(...))` guard was dead code.
  assert.equal(!result, false);
  return result; // let the promise settle
});

test('awaited limiter trips once the bucket is exhausted', async () => {
  resetRateLimitBuckets();
  // capacity 2, effectively no refill within the test window.
  const opts = { capacity: 2, refillPerSec: 0.0001 };
  assert.equal(await allowRequest('await-trip:ip', opts), true);
  assert.equal(await allowRequest('await-trip:ip', opts), true);
  assert.equal(
    await allowRequest('await-trip:ip', opts),
    false,
    'third request must be blocked once the two tokens are spent'
  );
  resetRateLimitBuckets();
});
