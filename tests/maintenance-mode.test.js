/**
 * Maintenance mode — "we're right back, your work is saved".
 *
 * The load-bearing assertions are the two asymmetries the feature rests on:
 *
 * - **Writes are refused, reads are not.** Blocking GETs would turn a two-minute
 *   deploy into a hard outage for viewers and presenters who are not writing
 *   anything, so the gate has to key on the method and nothing else.
 * - **The announcement goes out on shutdown, not on boot.** The container that
 *   holds the open connections is the one going away; a fresh container booting
 *   with `MAINTENANCE_MODE=1` would be announcing to an empty room.
 *
 * Run with: node --test tests/maintenance-mode.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMaintenanceState,
  isMaintenanceActive,
  isWriteMethod,
  maintenanceRetryAfterSeconds,
  resetMaintenanceForTests,
  setMaintenanceActive,
} from '../server/config/maintenance.js';
import {
  addClient,
  broadcastToAll,
  removeClient,
  MaintenanceEventTypes,
} from '../server/services/comment-events.js';
import { announceMaintenance } from '../server/services/maintenance.js';

/** Minimal SSE client stand-in that records what was written to it. */
function mockClient() {
  return {
    written: [],
    write(chunk) {
      this.written.push(String(chunk));
    },
  };
}

test('the flag defaults off and reports a usable retry hint', () => {
  resetMaintenanceForTests();
  assert.equal(isMaintenanceActive(), false);
  assert.deepEqual(getMaintenanceState(), {
    active: false,
    reason: null,
    retryAfter: 30,
  });
  assert.ok(maintenanceRetryAfterSeconds() > 0);
});

test('setMaintenanceActive reports whether it actually changed anything', () => {
  resetMaintenanceForTests();
  assert.equal(setMaintenanceActive(true, { reason: 'shutdown' }), true, 'off -> on changed');
  assert.equal(setMaintenanceActive(true), false, 'on -> on is a no-op');
  assert.equal(getMaintenanceState().reason, 'shutdown', 'the first reason survives the no-op');
  assert.equal(setMaintenanceActive(false), true, 'on -> off changed');
  assert.equal(getMaintenanceState().reason, null, 'clearing drops the reason');
  resetMaintenanceForTests();
});

test('only writes are refused; reads must keep working during a restart', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete']) {
    assert.equal(isWriteMethod(m), true, `${m} writes`);
  }
  // A read-only Deckyard is still a useful Deckyard: viewers, presenters and
  // shared links must survive the deploy window untouched.
  for (const m of ['GET', 'HEAD', 'OPTIONS', '', undefined, null]) {
    assert.equal(isWriteMethod(m), false, `${String(m)} does not write`);
  }
});

test('broadcastToAll reaches every client across every presentation', () => {
  const a = mockClient();
  const b = mockClient();
  const c = mockClient();
  addClient('pres-1', a);
  addClient('pres-1', b);
  addClient('pres-2', c);

  try {
    const sent = broadcastToAll(MaintenanceEventTypes.CHANGED, { active: true });
    assert.equal(sent, 3, 'all three connections written to');
    for (const client of [a, b, c]) {
      assert.equal(client.written.length, 1);
      assert.match(client.written[0], /event: maintenance:changed/);
      assert.match(client.written[0], /"active":true/);
    }
  } finally {
    removeClient('pres-1', a);
    removeClient('pres-1', b);
    removeClient('pres-2', c);
  }
});

test('a dead connection does not stop the announcement reaching the live ones', () => {
  const dead = {
    write() {
      throw new Error('EPIPE');
    },
  };
  const live = mockClient();
  addClient('pres-1', dead);
  addClient('pres-1', live);

  try {
    const sent = broadcastToAll(MaintenanceEventTypes.CHANGED, { active: true });
    assert.equal(sent, 1, 'only the live connection counts');
    assert.equal(live.written.length, 1, 'and it still got the message');
  } finally {
    removeClient('pres-1', dead);
    removeClient('pres-1', live);
  }
});

test('announceMaintenance flips the flag and tells the clients in one step', () => {
  resetMaintenanceForTests();
  const client = mockClient();
  addClient('pres-1', client);

  try {
    const on = announceMaintenance(true, { reason: 'shutdown' });
    assert.equal(on.changed, true);
    assert.equal(on.notified, 1);
    assert.equal(isMaintenanceActive(), true);
    assert.match(client.written[0], /"reason":"shutdown"/);

    // Repeating it is not a state change but must still answer, so a client
    // that connected after the flip is not left guessing.
    const again = announceMaintenance(true, { reason: 'shutdown' });
    assert.equal(again.changed, false);
    assert.equal(again.notified, 1, 'still broadcast');

    const off = announceMaintenance(false);
    assert.equal(off.changed, true);
    assert.equal(isMaintenanceActive(), false);
    assert.match(client.written.at(-1), /"active":false/);
  } finally {
    removeClient('pres-1', client);
    resetMaintenanceForTests();
  }
});

test('MAINTENANCE_RETRY_AFTER_SECONDS overrides the default, garbage does not', () => {
  const original = process.env.MAINTENANCE_RETRY_AFTER_SECONDS;
  try {
    process.env.MAINTENANCE_RETRY_AFTER_SECONDS = '120';
    assert.equal(maintenanceRetryAfterSeconds(), 120);
    process.env.MAINTENANCE_RETRY_AFTER_SECONDS = 'soon';
    assert.equal(maintenanceRetryAfterSeconds(), 30, 'falls back rather than sending NaN');
    process.env.MAINTENANCE_RETRY_AFTER_SECONDS = '-5';
    assert.equal(maintenanceRetryAfterSeconds(), 30, 'a negative wait is not a wait');
  } finally {
    if (original === undefined) delete process.env.MAINTENANCE_RETRY_AFTER_SECONDS;
    else process.env.MAINTENANCE_RETRY_AFTER_SECONDS = original;
  }
});
