import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowLoginAttempt, LOGIN_LIMITS } from '../server/utils/rate-limit.js';

/**
 * Security hardening 3c: password login must be brute-force throttled. The
 * per-email bucket (capacity 8) is the tighter of the two, so a burst against
 * one account from one IP is blocked once it empties.
 */

test('blocks after the per-email burst capacity is exhausted', async () => {
  const ip = '203.0.113.7';
  const email = `victim-${Math.floor(performance.now())}@example.com`;
  const cap = LOGIN_LIMITS.email.capacity;

  let allowed = 0;
  for (let i = 0; i < cap; i++) {
    assert.equal(await allowLoginAttempt({ ip, email }), true, `attempt ${i + 1}`);
    allowed++;
  }
  assert.equal(allowed, cap);
  // Next attempt (same ip+email, no time for refill) is blocked.
  assert.equal(await allowLoginAttempt({ ip, email }), false);
});

test('per-IP bucket blocks address-rotating attacks across many emails', async () => {
  const ip = '203.0.113.99';
  const cap = LOGIN_LIMITS.ip.capacity;
  let blocked = false;
  // Each attempt uses a fresh email (email bucket never fills), so the per-IP
  // bucket is what stops it after its capacity.
  for (let i = 0; i < cap + 2; i++) {
    const ok = await allowLoginAttempt({ ip, email: `u${i}@example.com` });
    if (!ok) blocked = true;
  }
  assert.equal(blocked, true, 'per-IP bucket should block after capacity');
});

test('distinct IPs are throttled independently', async () => {
  const email = `shared-${Math.floor(performance.now())}@example.com`;
  assert.equal(await allowLoginAttempt({ ip: '198.51.100.1', email }), true);
  assert.equal(await allowLoginAttempt({ ip: '198.51.100.2', email }), true);
});
