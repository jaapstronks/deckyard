import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRequestRateLimit,
  resetRateLimitBuckets,
} from '../server/utils/rate-limit.js';
import { checkRateLimitRedis } from '../server/utils/rate-limit-redis.js';

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

test('Redis refusal uses accepted scores and removes the denied attempt', async (t) => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  t.after(() => {
    Date.now = originalNow;
  });

  const members = new Map([
    ['first', now - 20_000],
    ['second', now - 10_000],
  ]);
  let ttl = null;
  const redis = {
    pipeline() {
      const commands = [];
      const pipeline = {
        zremrangebyscore: (...args) => {
          commands.push(['removeExpired', args]);
          return pipeline;
        },
        zcard: (...args) => {
          commands.push(['count', args]);
          return pipeline;
        },
        zrange: (...args) => {
          commands.push(['range', args]);
          return pipeline;
        },
        zadd: (...args) => {
          commands.push(['add', args]);
          return pipeline;
        },
        expire: (...args) => {
          commands.push(['expire', args]);
          return pipeline;
        },
        async exec() {
          return commands.map(([command, args]) => {
            const [, a, b] = args;
            let value;
            if (command === 'removeExpired') {
              for (const [member, score] of members)
                if (score <= b) members.delete(member);
              value = 0;
            } else if (command === 'count') value = members.size;
            else if (command === 'range') {
              const sorted = [...members].sort((x, y) => x[1] - y[1]);
              const pair = sorted[a === 0 ? 0 : sorted.length - 1];
              value = pair ? [pair[0], String(pair[1])] : [];
            } else if (command === 'add') {
              members.set(b, a);
              value = 1;
            } else {
              ttl = a;
              value = 1;
            }
            return [null, value];
          });
        },
      };
      return pipeline;
    },
    async zrem(_key, member) {
      members.delete(member);
    },
  };

  const decision = await checkRateLimitRedis(
    'decision:redis',
    { capacity: 2, windowSeconds: 60 },
    async (fn) => fn(redis),
  );
  assert.deepEqual(decision, {
    allowed: false,
    limit: 2,
    remaining: 0,
    resetAt: 1050,
    retryAfter: 40,
  });
  assert.equal(ttl, 70);
  assert.deepEqual([...members.keys()], ['first', 'second']);

  now += 40_001;
  const admitted = await checkRateLimitRedis(
    'decision:redis',
    { capacity: 2, windowSeconds: 60 },
    async (fn) => fn(redis),
  );
  assert.deepEqual(admitted, {
    allowed: true,
    limit: 2,
    remaining: 0,
    resetAt: 1101,
    retryAfter: 0,
  });
  assert.equal(
    members.has('first'),
    false,
    'the expired attempt left the window',
  );
  assert.equal(members.size, 2);
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
