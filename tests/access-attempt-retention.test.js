/**
 * Revoked-link attempts have a lifetime, and the author notification carries
 * no accessor IP (B785).
 *
 * `access_attempt_log` has one reader: the per-accessor deduplication that
 * keeps the author from being notified twice in 24 hours. So the record is
 * written only when a notification is actually sent, the retention job
 * deletes it once it leaves the window, and the notification's JSON `data`
 * (which no client reads beyond `export_ready`'s `jobId`) no longer copies
 * the IP. Migration 093 clears the backlog of both at upgrade time.
 *
 * Run with: node --test tests/access-attempt-retention.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { testScope } = await import('./helpers/storage-scope.js');
const { crossOrganizationScope } = await import('../server/storage/scope.js');
const { notifyAuthorOfAccessAttempt, ACCESS_TYPES } =
  await import('../server/services/access-notifications.js');
const { deleteOldAccessAttempts, ACCESS_ATTEMPT_WINDOW_MS } =
  await import('../server/storage/access-attempts.js');
const { runRetentionCleanup } =
  await import('../server/jobs/retention-cleanup.js');
const { up: migrate093 } =
  await import('../server/db/migrations/093_access_attempt_retention.js');

const scope = testScope();
const ORG = scope.organizationId;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
const DECK = '00000000-0000-0000-0000-00000000d0c5';
const LINK = '00000000-0000-0000-0000-0000000011aa';
const AUTHOR = 'author@example.com';
const IP = '203.0.113.7';
const OTHER_IP = '198.51.100.9';

const MINUTE_MS = 60 * 1000;
const agoIso = (ms) => new Date(Date.now() - ms).toISOString();
const pastWindowIso = () => agoIso(ACCESS_ATTEMPT_WINDOW_MS + MINUTE_MS);
const insideWindowIso = () => agoIso(ACCESS_ATTEMPT_WINDOW_MS - MINUTE_MS);

/** A notified attempt row as the storage layer writes it. */
function notifiedRow(overrides = {}) {
  const at = overrides.attempted_at || new Date().toISOString();
  return {
    id: `a-${Math.random().toString(16).slice(2)}`,
    organization_id: ORG,
    presentation_id: DECK,
    access_type: ACCESS_TYPES.SHARE_LINK,
    access_reference_id: LINK,
    accessor_email: null,
    accessor_ip: IP,
    attempted_at: at,
    author_notified_at: at,
    ...overrides,
  };
}

function freshDb(tables = {}) {
  const db = createFakeDb({
    access_attempt_log: [],
    user_notifications: [],
    users: [],
    ...tables,
  });
  __setTestDb(db);
  return db;
}

const attempt = (overrides = {}) =>
  notifyAuthorOfAccessAttempt({
    presentationId: DECK,
    presentationTitle: 'Quarterly review',
    authorEmail: AUTHOR,
    accessType: ACCESS_TYPES.SHARE_LINK,
    accessReferenceId: LINK,
    accessorIp: IP,
    scope,
    ...overrides,
  });

test.afterEach(() => {
  __setTestDb(null);
});

test('the first attempt notifies the author; the record is notified at birth and the notification has no IP', async () => {
  const db = freshDb();

  assert.deepEqual(await attempt(), { ok: true, notified: true });

  const rows = db.__tables.access_attempt_log;
  assert.equal(rows.length, 1, 'one attempt record');
  assert.equal(rows[0].accessor_ip, IP, 'the record holds the IP for dedupe');
  assert.ok(rows[0].author_notified_at, 'notified in the same insert');
  assert.equal(rows[0].author_notified_at, rows[0].attempted_at);

  const notifications = db.__tables.user_notifications;
  assert.equal(notifications.length, 1, 'one notification');
  const [n] = notifications;
  assert.equal(n.user_email, AUTHOR);
  assert.equal(n.notification_type, 'access_attempt');
  assert.equal(n.title, 'Someone tried to access revoked content');
  assert.equal(
    n.body,
    'Attempted to access "Quarterly review" via a revoked share link.',
  );
  assert.deepEqual(n.data, {
    accessType: ACCESS_TYPES.SHARE_LINK,
    presentationTitle: 'Quarterly review',
  });
  assert.equal('accessorIp' in n.data, false, 'no IP in the notification');
});

test('a second attempt inside the window notifies nobody and writes nothing', async () => {
  const db = freshDb();
  await attempt();

  assert.deepEqual(await attempt(), {
    ok: true,
    notified: false,
    reason: 'rate_limited',
  });

  assert.equal(db.__tables.access_attempt_log.length, 1, 'no second record');
  assert.equal(
    db.__tables.user_notifications.length,
    1,
    'no second notification',
  );
});

test('a second attempt from another accessor inside the window is its own notification', async () => {
  const db = freshDb();
  await attempt();

  assert.deepEqual(await attempt({ accessorIp: OTHER_IP }), {
    ok: true,
    notified: true,
  });
  assert.deepEqual(
    db.__tables.access_attempt_log.map((r) => r.accessor_ip),
    [IP, OTHER_IP],
  );
  assert.equal(db.__tables.user_notifications.length, 2);
});

test('once the window has passed the same accessor notifies the author again', async () => {
  const db = freshDb({
    access_attempt_log: [notifiedRow({ attempted_at: pastWindowIso() })],
  });

  assert.deepEqual(await attempt(), { ok: true, notified: true });
  assert.equal(db.__tables.access_attempt_log.length, 2);
  assert.equal(db.__tables.user_notifications.length, 1);
});

test('a record inside the window still deduplicates, whatever its age in it', async () => {
  const db = freshDb({
    access_attempt_log: [notifiedRow({ attempted_at: insideWindowIso() })],
  });

  const result = await attempt();
  assert.equal(result.notified, false);
  assert.equal(db.__tables.access_attempt_log.length, 1);
  assert.equal(db.__tables.user_notifications.length, 0);
});

test('an attempt whose notification cannot be created leaves no record', async () => {
  const db = freshDb();

  // An author without an address: createNotification refuses it.
  const result = await attempt({ authorEmail: '' });
  assert.deepEqual(result, {
    ok: true,
    notified: false,
    reason: 'notification_failed',
  });
  assert.equal(db.__tables.access_attempt_log.length, 0, 'nothing written');
  assert.equal(db.__tables.user_notifications.length, 0);
});

test('deleteOldAccessAttempts takes only an instance retention scope', async () => {
  freshDb();
  const cutoff = new Date().toISOString();
  await assert.rejects(deleteOldAccessAttempts(undefined, cutoff), TypeError);
  await assert.rejects(
    deleteOldAccessAttempts(scope, cutoff),
    /requires an instance retention scope/,
  );
  await assert.rejects(
    deleteOldAccessAttempts(
      { ...scope, crossOrganization: 'test: both' },
      cutoff,
    ),
    /requires an instance retention scope/,
  );
});

test('the retention job deletes records past the window across organizations and keeps the rest', async () => {
  const db = freshDb({
    access_attempt_log: [
      notifiedRow({ id: 'old-a', attempted_at: pastWindowIso() }),
      notifiedRow({
        id: 'old-b',
        organization_id: OTHER_ORG,
        attempted_at: agoIso(30 * 24 * 60 * MINUTE_MS),
      }),
      notifiedRow({ id: 'young-a', attempted_at: insideWindowIso() }),
      notifiedRow({
        id: 'young-b',
        organization_id: OTHER_ORG,
        attempted_at: agoIso(MINUTE_MS),
      }),
    ],
  });

  const result = await runRetentionCleanup({ activityRetentionDays: 180 });

  assert.equal(result.accessAttempts, 2);
  assert.deepEqual(
    db.__tables.access_attempt_log.map((r) => r.id),
    ['young-a', 'young-b'],
  );

  // The storage seam behind it, under the instance scope the job constructs.
  const retention = crossOrganizationScope(null, 'test: instance retention');
  assert.deepEqual(
    await deleteOldAccessAttempts(retention, new Date().toISOString()),
    { deleted: 2 },
  );
  assert.deepEqual(db.__tables.access_attempt_log, []);
});

test('migration 093 clears the backlog: old attempts go, the IP key leaves access_attempt notifications, nothing else moves', async () => {
  const commentData = { commentId: 'c-1', accessorIp: 'not ours to touch' };
  const db = freshDb({
    access_attempt_log: [
      notifiedRow({ id: 'old', attempted_at: pastWindowIso() }),
      notifiedRow({
        id: 'old-unnotified',
        attempted_at: pastWindowIso(),
        author_notified_at: null,
      }),
      notifiedRow({ id: 'young', attempted_at: insideWindowIso() }),
    ],
    user_notifications: [
      {
        id: 'n-legacy',
        organization_id: ORG,
        user_email: AUTHOR,
        notification_type: 'access_attempt',
        title: 'Someone tried to access revoked content',
        data: {
          accessType: 'share_link',
          accessorIp: IP,
          presentationTitle: 'Quarterly review',
        },
      },
      {
        id: 'n-clean',
        organization_id: ORG,
        user_email: AUTHOR,
        notification_type: 'access_attempt',
        title: 'Someone tried to access revoked content',
        data: { accessType: 'share_link', presentationTitle: 'Other deck' },
      },
      {
        id: 'n-comment',
        organization_id: ORG,
        user_email: AUTHOR,
        notification_type: 'comment_mention',
        title: 'You were mentioned',
        data: commentData,
      },
    ],
  });

  await migrate093(db);

  assert.deepEqual(
    db.__tables.access_attempt_log.map((r) => r.id),
    ['young'],
    'rows past the window are gone, notified or not',
  );
  const byId = Object.fromEntries(
    db.__tables.user_notifications.map((r) => [r.id, r]),
  );
  assert.deepEqual(byId['n-legacy'].data, {
    accessType: 'share_link',
    presentationTitle: 'Quarterly review',
  });
  assert.deepEqual(byId['n-clean'].data, {
    accessType: 'share_link',
    presentationTitle: 'Other deck',
  });
  assert.deepEqual(
    byId['n-comment'].data,
    commentData,
    'another notification type keeps its data, key and all',
  );

  // Idempotent: a second run changes nothing.
  const before = JSON.stringify(db.__tables);
  await migrate093(db);
  assert.equal(JSON.stringify(db.__tables), before);
});

test('a record inside the window deduplicates whatever author_notified_at says: the column is set at birth, not a filter (B786)', async () => {
  const db = freshDb({
    access_attempt_log: [
      notifiedRow({
        id: 'legacy-unnotified',
        attempted_at: insideWindowIso(),
        author_notified_at: null,
      }),
    ],
  });

  const result = await attempt();
  assert.equal(result.notified, false);
  assert.equal(db.__tables.access_attempt_log.length, 1, 'no second row');
  assert.deepEqual(db.__tables.user_notifications, []);
});
