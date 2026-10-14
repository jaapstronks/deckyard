import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRequestRateLimit,
  resetRateLimitBuckets,
} from '../server/utils/rate-limit.js';

test('in-memory decision reports fractional refill and the next admission', async (t) => {
  const originalNow = Date.now;
  const originalRedisEnabled = process.env.REDIS_ENABLED;
  let now = 1_000_000;
  Date.now = () => now;
  process.env.REDIS_ENABLED = 'false';
  resetRateLimitBuckets();
  t.after(() => {
    Date.now = originalNow;
    if (originalRedisEnabled === undefined) delete process.env.REDIS_ENABLED;
    else process.env.REDIS_ENABLED = originalRedisEnabled;
    resetRateLimitBuckets();
  });

  const options = { capacity: 2, refillPerSec: 0.5 };
  assert.deepEqual(await checkRequestRateLimit('decision:memory', options), {
    allowed: true,
    limit: 2,
    remaining: 1,
    resetAt: 1002,
    retryAfter: 0,
  });
  assert.equal(
    (await checkRequestRateLimit('decision:memory', options)).remaining,
    0,
  );
  assert.deepEqual(await checkRequestRateLimit('decision:memory', options), {
    allowed: false,
    limit: 2,
    remaining: 0,
    resetAt: 1004,
    retryAfter: 2,
  });
  now += 1_000;
  assert.equal(
    (await checkRequestRateLimit('decision:memory', options)).retryAfter,
    1,
  );
  now += 1_000;
  assert.deepEqual(await checkRequestRateLimit('decision:memory', options), {
    allowed: true,
    limit: 2,
    remaining: 0,
    resetAt: 1006,
    retryAfter: 0,
  });
});

test('a clock running behind neither drains nor gifts tokens', async (t) => {
  const originalNow = Date.now;
  const originalRedisEnabled = process.env.REDIS_ENABLED;
  let now = 5_000_000;
  Date.now = () => now;
  process.env.REDIS_ENABLED = 'false';
  resetRateLimitBuckets();
  t.after(() => {
    Date.now = originalNow;
    if (originalRedisEnabled === undefined) delete process.env.REDIS_ENABLED;
    else process.env.REDIS_ENABLED = originalRedisEnabled;
    resetRateLimitBuckets();
  });

  const key = 'decision:clock-behind';
  const options = { capacity: 10, refillPerSec: 0.1 };
  for (let i = 0; i < 10; i++) {
    assert.equal((await checkRequestRateLimit(key, options)).allowed, true);
  }
  const drained = await checkRequestRateLimit(key, options);
  assert.equal(drained.allowed, false);
  assert.equal(drained.retryAfter, 10);

  now -= 60_000;
  const behind = await checkRequestRateLimit(key, options);
  assert.equal(behind.allowed, false);
  assert.equal(behind.remaining, 0);
  assert.equal(behind.retryAfter, drained.retryAfter);

  now += 60_000;
  const restored = await checkRequestRateLimit(key, options);
  assert.equal(restored.allowed, false, 'no token was gifted');
  assert.equal(restored.remaining, 0);
  assert.equal(restored.retryAfter, drained.retryAfter);
});

test('a Redis miss falls back to the in-memory decision with header values', async () => {
  resetRateLimitBuckets();
  const backend = {
    redisAvailable: () => true,
    checkRedis: async () => null,
  };
  const options = { capacity: 1, refillPerSec: 0.01 };
  const first = await checkRequestRateLimit(
    'decision:fallback',
    options,
    backend,
  );
  const refused = await checkRequestRateLimit(
    'decision:fallback',
    options,
    backend,
  );
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 0);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.equal(refused.limit, 1);
  assert.ok(refused.retryAfter > 0);
  assert.ok(refused.resetAt > Date.now() / 1000);
  resetRateLimitBuckets();
});

test('a thrown Redis failure uses an independent local budget', async () => {
  resetRateLimitBuckets();
  const options = { capacity: 1, refillPerSec: 0.001 };
  const backend = {
    redisAvailable: () => true,
    checkRedis: async () => {
      throw new Error('test Redis outage');
    },
  };
  assert.equal(
    (await checkRequestRateLimit('exception', options, backend)).allowed,
    true,
  );
  assert.equal(
    (await checkRequestRateLimit('exception', options, backend)).allowed,
    false,
  );
  resetRateLimitBuckets();
});
