/**
 * Retention cleanup job (server/jobs/retention-cleanup.js).
 *
 * The storage cleanups it drives were complete but never scheduled, so
 * api_usage_daily, presentation_share_links, activity_events and slide_locks
 * grew without bound. These tests pin the behaviour that matters: old rows go,
 * recent rows stay, and activity events plus slide locks are trimmed across
 * every organization (a scheduled job has no org context) — plus the scheduler
 * returns a stoppable handle.
 *
 * Run with: node --test tests/retention-cleanup.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { runRetentionCleanup, scheduleRetentionCleanup } = await import(
  '../server/jobs/retention-cleanup.js'
);

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgoIso = (n) => new Date(now - n * DAY_MS).toISOString();
const daysAgoDate = (n) => new Date(now - n * DAY_MS).toISOString().split('T')[0];
const daysAheadIso = (n) => new Date(now + n * DAY_MS).toISOString();

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const ORG_B = '00000000-0000-0000-0000-0000000000bb';

test.afterEach(() => {
  __setTestDb(null);
});

test('runRetentionCleanup trims old rows and keeps recent ones', async () => {
  const db = createFakeDb({
    // api_usage_daily: 90-day cutoff lives in the query itself.
    api_usage_daily: [
      { id: 'u-old', date: daysAgoDate(120), organization_id: ORG_A, request_count: 5 },
      { id: 'u-new', date: daysAgoDate(10), organization_id: ORG_A, request_count: 5 },
    ],
    // Share links: expired + not-yet-revoked flips to revoked; future stays;
    // already-revoked expired is left alone.
    presentation_share_links: [
      { id: 's-expired', expires_at: daysAgoIso(1), revoked_at: null, revoked_by: null },
      { id: 's-future', expires_at: daysAheadIso(30), revoked_at: null, revoked_by: null },
      { id: 's-already', expires_at: daysAgoIso(2), revoked_at: daysAgoIso(2), revoked_by: 'someone@example.com' },
    ],
    // Activity events across two orgs: old goes instance-wide, recent stays.
    activity_events: [
      { id: 'e-old-a', organization_id: ORG_A, created_at: daysAgoIso(200), actor_email: 'a@example.com' },
      { id: 'e-old-b', organization_id: ORG_B, created_at: daysAgoIso(365), actor_email: 'b@example.com' },
      { id: 'e-new-a', organization_id: ORG_A, created_at: daysAgoIso(10), actor_email: 'a@example.com' },
    ],
    // Slide locks across two orgs: expired goes instance-wide, live stays.
    slide_locks: [
      { id: 'l-expired-a', organization_id: ORG_A, expires_at: daysAgoIso(1) },
      { id: 'l-expired-b', organization_id: ORG_B, expires_at: daysAgoIso(30) },
      { id: 'l-live-a', organization_id: ORG_A, expires_at: daysAheadIso(1) },
    ],
  });
  __setTestDb(db);

  const result = await runRetentionCleanup({ activityRetentionDays: 180 });

  assert.deepEqual(result, { usage: 1, shareLinks: 1, activityEvents: 2, slideLocks: 2 });

  // api_usage_daily: only the recent row survives.
  assert.deepEqual(
    db.__tables.api_usage_daily.map((r) => r.id),
    ['u-new']
  );

  // Share links: the expired one is revoked by the system marker, the future
  // one is untouched, the already-revoked one keeps its original revoker.
  const links = Object.fromEntries(db.__tables.presentation_share_links.map((r) => [r.id, r]));
  assert.equal(links['s-expired'].revoked_by, 'system:expired');
  assert.equal(links['s-future'].revoked_at, null);
  assert.equal(links['s-already'].revoked_by, 'someone@example.com');

  // Activity events: both old events gone regardless of org; recent stays.
  assert.deepEqual(
    db.__tables.activity_events.map((r) => r.id),
    ['e-new-a']
  );

  // Slide locks: both expired locks gone regardless of org; the live one stays.
  assert.deepEqual(
    db.__tables.slide_locks.map((r) => r.id),
    ['l-live-a']
  );
});

test('runRetentionCleanup honours a custom activity retention window', async () => {
  const db = createFakeDb({
    activity_events: [
      { id: 'e-90', organization_id: ORG_A, created_at: daysAgoIso(90), actor_email: 'a@example.com' },
      { id: 'e-20', organization_id: ORG_A, created_at: daysAgoIso(20), actor_email: 'a@example.com' },
    ],
  });
  __setTestDb(db);

  // 30-day window: the 90-day-old event goes, the 20-day-old event stays.
  const result = await runRetentionCleanup({ activityRetentionDays: 30 });

  assert.equal(result.activityEvents, 1);
  assert.deepEqual(
    db.__tables.activity_events.map((r) => r.id),
    ['e-20']
  );
});

test('scheduleRetentionCleanup returns a stoppable handle', () => {
  // No test db set: withDbGuard short-circuits to fallbacks, so the immediate
  // run is a no-op. We only pin the scheduling shape here.
  const job = scheduleRetentionCleanup({ intervalMs: 60_000 });
  assert.equal(typeof job.stop, 'function');
  assert.doesNotThrow(() => job.stop());
  assert.doesNotThrow(() => job.stop()); // idempotent
});
