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

// A storage scope states the organization it acts in; the layer refuses one
// that does not (tests/storage-call-convention: scope-first, validate-first).
const ORG = { organizationId: '00000000-0000-0000-0000-0000000000aa' };

describe('scope refusal', () => {
  it('throws on a missing or organization-less scope', async () => {
    await assert.rejects(getUnreadCount(null, 'a@b.c'), TypeError);
    await assert.rejects(getUnreadCount({}, 'a@b.c'), TypeError);
  });
});

describe('archiveNotification (no-DB contract)', () => {
  it('validates params', async () => {
    assert.deepStrictEqual(await archiveNotification(ORG, '', 'a@b.c'), {
      ok: false,
      reason: 'invalid',
    });
    assert.deepStrictEqual(await archiveNotification(ORG, 'n-1', ''), {
      ok: false,
      reason: 'invalid',
    });
  });

  it('reports unavailable without a database', async () => {
    assert.deepStrictEqual(await archiveNotification(ORG, 'n-1', 'a@b.c'), {
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('archiveAllNotifications (no-DB contract)', () => {
  it('requires an email', async () => {
    assert.deepStrictEqual(await archiveAllNotifications(ORG, ''), {
      ok: false,
      reason: 'invalid_email',
    });
  });

  it('reports unavailable without a database', async () => {
    assert.deepStrictEqual(await archiveAllNotifications(ORG, 'a@b.c'), {
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('archiveThreadNotifications (no-DB contract)', () => {
  it('validates params', async () => {
    assert.deepStrictEqual(
      await archiveThreadNotifications(ORG, '', 'p-1', 't-1'),
      { ok: false, reason: 'invalid' },
    );
    assert.deepStrictEqual(
      await archiveThreadNotifications(ORG, 'a@b.c', '', 't-1'),
      { ok: false, reason: 'invalid' },
    );
    assert.deepStrictEqual(
      await archiveThreadNotifications(ORG, 'a@b.c', 'p-1', ''),
      { ok: false, reason: 'invalid' },
    );
  });

  it('reports unavailable without a database', async () => {
    assert.deepStrictEqual(
      await archiveThreadNotifications(ORG, 'a@b.c', 'p-1', 't-1'),
      { ok: false, reason: 'unavailable' },
    );
  });
});

describe('list/count guards still hold with the new options', () => {
  it('listNotifications returns [] without a user or DB, for every filter shape', async () => {
    assert.deepStrictEqual(await listNotifications(ORG, '', {}), []);
    assert.deepStrictEqual(
      await listNotifications(ORG, 'a@b.c', { archived: true }),
      [],
    );
    assert.deepStrictEqual(
      await listNotifications(ORG, 'a@b.c', { types: ['comment_mention'] }),
      [],
    );
  });

  it('getUnreadCount returns 0 without a user or DB', async () => {
    assert.strictEqual(await getUnreadCount(ORG, ''), 0);
    assert.strictEqual(await getUnreadCount(ORG, 'a@b.c'), 0);
  });
});
