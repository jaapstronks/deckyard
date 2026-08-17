/**
 * Lifecycle teardown contract for the editor cleanup registry: it must not
 * silently swallow a cleanup that arrives after teardown (a late dynamic import
 * or fetch used to strand its teardown in a map nobody drained). The sibling
 * "nothing outlives its view" contract for the SSE helper lives in
 * `tests/sse-connection.test.js`.
 *
 * Run with: node --test tests/lifecycle-teardown.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createEditorCleanupRegistry } from '../client/views/editor/editor-cleanup.js';

describe('editor cleanup registry', () => {
  it('runs registered cleanups once on runAll()', () => {
    const reg = createEditorCleanupRegistry();
    let n = 0;
    reg.register('a', () => {
      n += 1;
    });
    reg.runAll();
    reg.runAll();
    assert.equal(n, 1);
  });

  it('runs a cleanup registered after teardown immediately', () => {
    // A dynamic import or fetch that resolves after the user navigated away
    // used to park its teardown in a map nobody would ever drain, stranding
    // window listeners and intervals for the life of the tab.
    const reg = createEditorCleanupRegistry();
    reg.runAll();
    let ran = false;
    reg.register('late', () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert.equal(reg.isTornDown, true);
  });

  it('runs a late update() immediately too', () => {
    const reg = createEditorCleanupRegistry();
    reg.runAll();
    let ran = false;
    reg.update('late', () => {
      ran = true;
    });
    assert.equal(ran, true);
  });

  it('keeps storing cleanups before teardown', () => {
    const reg = createEditorCleanupRegistry();
    let ran = false;
    reg.register('a', () => {
      ran = true;
    });
    assert.equal(ran, false);
    assert.equal(reg.size, 1);
    assert.equal(reg.isTornDown, false);
    reg.runAll();
    assert.equal(ran, true);
  });

  it('run(key) drains a single entry without ending the registry', () => {
    const reg = createEditorCleanupRegistry();
    let a = 0;
    let b = 0;
    reg.register('a', () => {
      a += 1;
    });
    reg.register('b', () => {
      b += 1;
    });
    reg.run('a');
    assert.equal(a, 1);
    assert.equal(b, 0);
    assert.equal(reg.isTornDown, false);
    reg.runAll();
    assert.equal(a, 1);
    assert.equal(b, 1);
  });

  it('a throwing cleanup does not block the rest', () => {
    const reg = createEditorCleanupRegistry();
    let ran = false;
    reg.register('boom', () => {
      throw new Error('nope');
    });
    reg.register('after', () => {
      ran = true;
    });
    reg.runAll();
    assert.equal(ran, true);
  });
});
