/**
 * Lifecycle teardown contracts.
 *
 * Two primitives carry the "nothing outlives its view" rule for the client:
 * the reconnecting-stream helper (which owns the pending retry timer) and the
 * editor cleanup registry (which must not silently swallow a cleanup that
 * arrives after teardown). Both used to leak; these lock the contracts down.
 *
 * Run with: node --test tests/lifecycle-teardown.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { withBackoff } from '../client/lib/net/reconnect.js';
import { createEditorCleanupRegistry } from '../client/views/editor/editor-cleanup.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('withBackoff', () => {
  it('does not connect until start()', () => {
    let opens = 0;
    withBackoff(() => {
      opens += 1;
      return () => {};
    });
    assert.equal(opens, 0);
  });

  it('runs the connection cleanup on stop()', () => {
    let closed = 0;
    const s = withBackoff(() => () => {
      closed += 1;
    });
    s.start();
    s.stop();
    assert.equal(closed, 1);
    assert.equal(s.isRunning, false);
  });

  it('cancels a pending reopen when stopped mid-backoff', async () => {
    let opens = 0;
    let errorCb = null;
    const s = withBackoff(
      ({ onError }) => {
        opens += 1;
        errorCb = onError;
        return () => {};
      },
      { baseDelayMs: 5 }
    );
    s.start();
    assert.equal(opens, 1);

    // First drop reconnects immediately (attempt was reset to 0 on open? no —
    // no onOpen fired, so this schedules a delayed retry).
    errorCb();
    s.stop();
    await tick(40);
    // The retry that was in flight when stop() landed must never fire. This is
    // the leak: a bare setTimeout would have opened a stream nothing can close.
    assert.equal(opens, 1);
  });

  it('reopens after a drop while running', async () => {
    let opens = 0;
    let errorCb = null;
    const s = withBackoff(
      ({ onError }) => {
        opens += 1;
        errorCb = onError;
        return () => {};
      },
      { baseDelayMs: 5 }
    );
    s.start();
    errorCb();
    await tick(40);
    assert.equal(opens, 2);
    s.stop();
  });

  it('stops for good on onDone and does not reopen', async () => {
    let opens = 0;
    let doneCb = null;
    const s = withBackoff(
      ({ onDone }) => {
        opens += 1;
        doneCb = onDone;
        return () => {};
      },
      { baseDelayMs: 5 }
    );
    s.start();
    doneCb();
    await tick(40);
    assert.equal(opens, 1);
    assert.equal(s.isRunning, false);
  });

  it('start() is idempotent while running but works again after stop()', () => {
    let opens = 0;
    const s = withBackoff(() => {
      opens += 1;
      return () => {};
    });
    s.start();
    s.start();
    assert.equal(opens, 1);
    s.stop();
    s.start();
    assert.equal(opens, 2);
    s.stop();
  });

  it('closes a connection whose connectFn returned after stop()', () => {
    // stop() landing during connectFn (a synchronous stand-in for an async
    // open) must still close the socket the factory just produced.
    let closed = 0;
    let stopDuringConnect = null;
    const s = withBackoff(() => {
      stopDuringConnect?.();
      return () => {
        closed += 1;
      };
    });
    stopDuringConnect = () => s.stop();
    s.start();
    assert.equal(closed, 1);
  });

  it('resets the backoff after a successful open', () => {
    let opens = 0;
    let cbs = null;
    const s = withBackoff(
      (c) => {
        opens += 1;
        cbs = c;
        return () => {};
      },
      { baseDelayMs: 5_000 }
    );
    s.start();
    cbs.onOpen();
    cbs.onError();
    // onOpen reset the attempt counter, so the reopen is immediate rather than
    // waiting out a 5s backoff.
    assert.equal(opens, 2);
    s.stop();
  });
});

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
