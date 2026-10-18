/**
 * The collab authorization lease (server/collab/lease.js, B767): once a
 * connection's lease has run out, nothing goes out to it before a fresh check
 * passes, whether the client sends anything or not.
 *
 * Driven with a fake clock and a fake connection; the real-socket boundary is
 * in tests/collab-writer-only-sync.test.js.
 *
 * Run with: node --test tests/collab-authorization-lease.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAuthorizationLease } from '../server/collab/lease.js';

const TTL = 10_000;

/** A deferred: a promise with its settlers. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A connection that records what it sent, a clock and a scripted check. */
function setup({ ttlMs = TTL } = {}) {
  const sent = [];
  const connection = { send: (message) => sent.push(message) };
  const clock = { t: 1_000 };
  const checks = [];
  let refused = 0;
  const lease = attachAuthorizationLease(connection, {
    ttlMs,
    authorizedAt: clock.t,
    authorize: () => {
      const check = deferred();
      checks.push(check);
      return check.promise;
    },
    onRefused: () => {
      refused += 1;
      connection.send('close');
    },
    now: () => clock.t,
  });
  return { connection, lease, sent, clock, checks, refused: () => refused };
}

const tick = () => new Promise((r) => setImmediate(r));

test('lease: within the lease every message goes out at once, unchecked', () => {
  const { connection, sent, clock, checks } = setup();
  connection.send('a');
  clock.t += TTL - 1;
  connection.send('b');
  assert.deepEqual(sent, ['a', 'b']);
  assert.equal(checks.length, 0);
});

test('lease: a run-out lease holds every message until one check passes', async () => {
  const { connection, sent, clock, checks } = setup();
  clock.t += TTL;
  connection.send('a');
  connection.send('b');
  assert.deepEqual(sent, [], 'nothing goes out before the check');
  assert.equal(checks.length, 1, 'one check for the held messages');

  clock.t += 5;
  checks[0].resolve();
  await tick();
  assert.deepEqual(sent, ['a', 'b'], 'released in order');

  // Renewed from the moment the check started.
  clock.t += TTL - 10;
  connection.send('c');
  assert.deepEqual(sent, ['a', 'b', 'c']);
  assert.equal(checks.length, 1);
});

test('lease: a refused check closes and drops what was held', async () => {
  const { connection, lease, sent, clock, checks, refused } = setup();
  clock.t += TTL;
  connection.send('update-after-revocation');
  checks[0].reject(new Error('forbidden'));
  await tick();
  assert.equal(refused(), 1);
  assert.deepEqual(sent, ['close'], 'only the close message goes out');
  assert.equal(await lease.renew(), false);
});

test('lease: renew() checks an incoming message the same way', async () => {
  const { lease, clock, checks } = setup();
  assert.equal(await lease.renew(), true, 'valid lease, no check');
  assert.equal(checks.length, 0);

  clock.t += TTL;
  const renewing = lease.renew();
  assert.equal(checks.length, 1);
  checks[0].resolve();
  assert.equal(await renewing, true);
});

test('lease: check() withdraws the lease at once', async () => {
  const { connection, lease, sent, checks, refused } = setup();
  const checking = lease.check();
  connection.send('during-check');
  assert.deepEqual(sent, [], 'held although the lease had time left');
  checks[0].reject(new Error('demoted'));
  assert.equal(await checking, false);
  assert.equal(refused(), 1);
  assert.deepEqual(sent, ['close']);
});

test('lease: a check from before a forced one cannot renew the lease', async () => {
  const { connection, lease, sent, clock, checks, refused } = setup();
  clock.t += TTL;
  connection.send('held');
  // A revocation lands while that check is still out.
  const forced = lease.check();
  checks[0].resolve(); // read the state from before the revocation
  await tick();
  assert.deepEqual(sent, [], 'the stale success releases nothing');
  checks[1].reject(new Error('revoked'));
  assert.equal(await forced, false);
  assert.equal(refused(), 1);
  assert.deepEqual(sent, ['close']);
});

test('lease: a check that hangs closes the connection after the lease length', async () => {
  const { connection, sent, clock, refused } = setup({ ttlMs: 30 });
  clock.t += 30;
  connection.send('held');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(refused(), 1);
  assert.deepEqual(sent, ['close']);
});

test('lease: dispose() drops held messages and stops gating', async () => {
  const { connection, lease, sent, clock, checks } = setup();
  clock.t += TTL;
  connection.send('held');
  lease.dispose();
  checks[0].resolve();
  await tick();
  assert.deepEqual(sent, [], 'a closed connection gets nothing it held');
  connection.send('close');
  assert.deepEqual(sent, ['close']);
});

test('lease: dispose() cancels the deadline of a running check', (t) => {
  const timeouts = t.mock.method(globalThis, 'setTimeout');
  const clears = t.mock.method(globalThis, 'clearTimeout');
  const { connection, lease, clock } = setup();
  clock.t += TTL;
  connection.send('held');
  assert.equal(
    timeouts.mock.callCount(),
    1,
    'the running check has a deadline',
  );
  const deadline = timeouts.mock.calls[0].result;
  lease.dispose();
  assert.ok(
    clears.mock.calls.some((call) => call.arguments[0] === deadline),
    'the deadline is cleared with the connection, not left for the lease length',
  );
});
