/**
 * Tests for the events-inbox archive state (phase 5 of the comments &
 * notifications plan): input/no-DB contracts of the archive storage
 * functions. The DB-backed behaviour (filtered lists, badge excluding
 * archived, auto-archive on own reply) needs a live Postgres and is
 * verified as a local integration step, matching this repo's test boundary.
 *
 * Run with: node --test tests/notification-inbox.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  archiveNotification,
  archiveAllNotifications,
  archiveThreadNotifications,
  listNotifications,
  getUnreadCount,
} from '../server/storage/notifications.js';

describe('archiveNotification (no-DB contract)', () => {
  it('validates params', async () => {
    assert.deepStrictEqual(
      await archiveNotification('', 'a@b.c', {}),
      { ok: false, reason: 'invalid_params' }
    );
    assert.deepStrictEqual(
      await archiveNotification('n-1', '', {}),
      { ok: false, reason: 'invalid_params' }
    );
  });

  it('reports unavailable without a database', async () => {
    assert.deepStrictEqual(
      await archiveNotification('n-1', 'a@b.c', {}),
      { ok: false, reason: 'unavailable' }
    );
  });
});

describe('archiveAllNotifications (no-DB contract)', () => {
  it('requires an email', async () => {
    assert.deepStrictEqual(
      await archiveAllNotifications('', {}),
      { ok: false, reason: 'invalid_email' }
    );
  });

  it('reports unavailable without a database', async () => {
    assert.deepStrictEqual(
      await archiveAllNotifications('a@b.c', {}),
      { ok: false, reason: 'unavailable' }
    );
  });
});

describe('archiveThreadNotifications (no-DB contract)', () => {
  it('validates params', async () => {
    assert.deepStrictEqual(
      await archiveThreadNotifications('', 'p-1', 't-1', {}),
      { ok: false, reason: 'invalid_params' }
    );
    assert.deepStrictEqual(
      await archiveThreadNotifications('a@b.c', '', 't-1', {}),
      { ok: false, reason: 'invalid_params' }
    );
    assert.deepStrictEqual(
      await archiveThreadNotifications('a@b.c', 'p-1', '', {}),
      { ok: false, reason: 'invalid_params' }
    );
  });

  it('reports unavailable without a database', async () => {
    assert.deepStrictEqual(
      await archiveThreadNotifications('a@b.c', 'p-1', 't-1', {}),
      { ok: false, reason: 'unavailable' }
    );
  });
});

describe('list/count guards still hold with the new options', () => {
  it('listNotifications returns [] without a user or DB, for every filter shape', async () => {
    assert.deepStrictEqual(await listNotifications('', {}, {}), []);
    assert.deepStrictEqual(await listNotifications('a@b.c', { archived: true }, {}), []);
    assert.deepStrictEqual(
      await listNotifications('a@b.c', { types: ['comment_mention'] }, {}),
      []
    );
  });

  it('getUnreadCount returns 0 without a user or DB', async () => {
    assert.strictEqual(await getUnreadCount('', {}), 0);
    assert.strictEqual(await getUnreadCount('a@b.c', {}), 0);
  });
});
