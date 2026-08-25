/**
 * Contract for `disposeAll` (client/lib/dom/disposal.js), the one place a
 * teardown failure is allowed to be swallowed (B150): every disposer runs,
 * in order, regardless of what the ones before it did — and an async
 * disposer's rejection is absorbed instead of surfacing as an unhandled
 * rejection.
 *
 * Run with: node --test tests/dispose-all.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { disposeAll } from '../client/lib/dom/disposal.js';

describe('disposeAll', () => {
  it('runs every disposer in order', () => {
    const ran = [];
    disposeAll([() => ran.push('a'), () => ran.push('b')]);
    assert.deepEqual(ran, ['a', 'b']);
  });

  it('skips null/undefined entries, so optional handles go in as-is', () => {
    const ran = [];
    disposeAll([null, undefined, () => ran.push('a')]);
    assert.deepEqual(ran, ['a']);
  });

  it('keeps going after a disposer throws', () => {
    const ran = [];
    disposeAll([
      () => {
        throw new Error('broken handle');
      },
      () => ran.push('after'),
    ]);
    assert.deepEqual(ran, ['after']);
  });

  it('absorbs a rejecting async disposer (no unhandled rejection)', async () => {
    // node --test fails the run on an unhandled rejection, so reaching the
    // assertion after a settle IS the assertion.
    disposeAll([() => Promise.reject(new Error('async broken handle'))]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(true);
  });
});
