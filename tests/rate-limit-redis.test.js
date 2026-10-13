import test from 'node:test';
import assert from 'node:assert/strict';
import Redis from 'ioredis';
import { allowRequestRedisDetails } from '../server/utils/rate-limit-redis.js';
import {
  checkRequestRateLimit,
  resetRateLimitBuckets,
} from '../server/utils/rate-limit.js';

// Explicit opt-in: use a disposable Redis, never an application's live DB.
// Example: RATE_LIMIT_TEST_REDIS_URL=redis://127.0.0.1:16379 node --test tests/rate-limit-redis.test.js
const url = process.env.RATE_LIMIT_TEST_REDIS_URL;

test(
  'real Redis token bucket matches every in-memory decision',
  { skip: !url },
  async (t) => {
    const redis = new Redis(url);
    const originalNow = Date.now;
    let now = 1_000_000;
    Date.now = () => now;
    const keys = [];
    t.after(async () => {
      Date.now = originalNow;
      resetRateLimitBuckets();
      if (keys.length) await redis.del(...keys);
      await redis.quit();
    });
    const run = (fn) => fn(redis);
    const cases = [
      { capacity: 2, refillPerSec: 0.5 },
      { capacity: 3, refillPerSec: 0.3 },
      { capacity: 1.5, refillPerSec: 2 },
      { capacity: 1.23456789012345, refillPerSec: 0.123456789012345 },
      { capacity: 0, refillPerSec: 0 },
      { capacity: -2, refillPerSec: -1 },
    ];
    for (const [index, options] of cases.entries()) {
      const key = `parity:${process.pid}:${index}`;
      keys.push(`ratelimit:token-bucket:${key}`);
      await redis.del(keys.at(-1));
      // Burst, refused requests that must not consume, fractional refill,
      // immediately before/at/after refill boundaries, and full reset.
      for (const elapsed of [
        0, 0, 0, 0, 1, 499, 500, 999, 1, 1, 1000, 1333, 1, 10000, 0,
      ]) {
        now += elapsed;
        const memory = await checkRequestRateLimit(key, options, {
          redisAvailable: () => false,
        });
        assert.deepEqual(
          await allowRequestRedisDetails(key, options, run),
          memory,
          `case ${index}, now ${now}`,
        );
      }
    }
  },
);

test(
  'real Redis concurrent clients cannot spend the same token',
  { skip: !url },
  async (t) => {
    const clients = Array.from({ length: 4 }, () => new Redis(url));
    const key = `concurrent:${process.pid}`;
    const redisKey = `ratelimit:token-bucket:${key}`;
    const originalNow = Date.now;
    Date.now = () => 2_000_000;
    t.after(async () => {
      Date.now = originalNow;
      await clients[0].del(redisKey);
      await Promise.all(clients.map((client) => client.quit()));
    });
    await clients[0].del(redisKey);
    const decisions = await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        allowRequestRedisDetails(
          key,
          { capacity: 17, refillPerSec: 0.001 },
          (fn) => fn(clients[index % clients.length]),
        ),
      ),
    );
    assert.equal(decisions.filter((d) => d.allowed).length, 17);
    assert.deepEqual(
      decisions
        .filter((d) => d.allowed)
        .map((d) => d.remaining)
        .sort((a, b) => a - b),
      Array.from({ length: 17 }, (_, index) => index),
    );
    assert.ok(
      decisions
        .filter((d) => !d.allowed)
        .every(
          (d) =>
            d.remaining === 0 && d.retryAfter === 1000 && d.resetAt === 19000,
        ),
    );
    const ttl = await clients[0].pttl(redisKey);
    assert.ok(ttl > 16_990_000 && ttl <= 17_000_000);
  },
);

test('Redis absence explicitly returns null', async () => {
  assert.equal(
    await allowRequestRedisDetails(
      'missing',
      { capacity: 2, refillPerSec: 1 },
      async (_fn, fallback) => fallback,
    ),
    null,
  );
});
