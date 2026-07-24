/**
 * Tests for the fire-and-forget background-promise guard.
 *
 * The guard exists so a rejecting un-awaited task can never become an unhandled
 * rejection (which under Node's default `--unhandled-rejections=throw` crashes
 * the process). The load-bearing assertion is therefore the negative one: a
 * rejecting promise passed to `fireAndForget` must NOT reach the process-level
 * `unhandledRejection` handler.
 *
 * Run with: node --test tests/fire-and-forget.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fireAndForget } from '../server/utils/fire-and-forget.js';

// Silence the guard's log.error so a deliberately-rejecting task doesn't spam
// the test output, and restore it afterwards.
function withSilencedErrors(fn) {
  const original = console.error;
  console.error = () => {};
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.error = original;
    });
}

/** Wait for the microtask + a macrotask so any pending .catch has settled. */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('a rejecting task does not surface as an unhandled rejection', async () => {
  const seen = [];
  const onUnhandled = (reason) => seen.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await withSilencedErrors(async () => {
      fireAndForget(Promise.reject(new Error('boom')), 'test task');
      await flush();
    });
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(seen, [], 'guard must swallow the rejection');
});

test('a resolving task settles cleanly and returns undefined', async () => {
  const ret = fireAndForget(Promise.resolve('ok'), 'happy task');
  assert.equal(ret, undefined);
  await flush();
});

test('a non-thenable argument is ignored without throwing', () => {
  assert.doesNotThrow(() => fireAndForget(undefined));
  assert.doesNotThrow(() => fireAndForget(null, 'noop'));
  assert.doesNotThrow(() => fireAndForget(42, 'not a promise'));
});

test("a task's own resolve handler still runs before the guard", async () => {
  let handled = false;
  fireAndForget(
    Promise.resolve({ ok: false }).then((r) => {
      handled = r.ok === false;
    }),
    'chained task'
  );
  await flush();
  assert.equal(handled, true);
});
