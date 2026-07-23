/**
 * Slide-lock HTTP status mapping (self-install-ux round 3).
 *
 * The acquire/refresh/release routes must reserve 409 Conflict for a genuine
 * contention (someone else holds the lock). Every other non-ok outcome — most
 * importantly `unavailable`, which is what file storage returns because it has
 * no lock DB — is not a conflict and must return 200, so a single-operator
 * editor doesn't log a misleading "409 Conflict" on every slide open.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lockHttpStatus } from '../server/routes/api/presentations/slide-locks.js';

test('a granted lock is 200', () => {
  assert.equal(lockHttpStatus({ ok: true, lock: {} }), 200);
});

test('a genuinely held lock is a 409 Conflict', () => {
  assert.equal(lockHttpStatus({ ok: false, reason: 'held', lock: {} }), 409);
});

test('no lock backend (file storage) is not a conflict — 200', () => {
  assert.equal(lockHttpStatus({ ok: false, reason: 'unavailable' }), 200);
});

test('invalid / expired / missing requests are not conflicts — 200', () => {
  assert.equal(lockHttpStatus({ ok: false, reason: 'invalid' }), 200);
  assert.equal(lockHttpStatus({ ok: false, reason: 'expired' }), 200);
  assert.equal(lockHttpStatus({ ok: false, reason: 'missing' }), 200);
});

test('a malformed result never throws and is treated as non-conflict', () => {
  assert.equal(lockHttpStatus(null), 200);
  assert.equal(lockHttpStatus(undefined), 200);
  assert.equal(lockHttpStatus({}), 200);
});
