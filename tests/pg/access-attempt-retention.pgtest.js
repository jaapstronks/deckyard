/**
 * Revoked-link attempt records and their notification against real
 * PostgreSQL (B785).
 *
 * The fake-db half (tests/access-attempt-retention.test.js) pins the
 * behaviour; this pins the two parts only PostgreSQL can vouch for: the jsonb
 * key removal migration 093 performs on `user_notifications.data`, and the
 * timestamptz comparison behind the deduplication window and the retention
 * delete. What this pins:
 *
 *  - migration 093 deletes attempt rows past the window, strips `accessorIp`
 *    from `access_attempt` notifications only, and finds nothing on a second
 *    run;
 *  - the service writes one notified record per notification and none for a
 *    suppressed attempt, and the notification's `data` has no IP;
 *  - `deleteOldAccessAttempts` removes rows past the window across
 *    organizations and keeps the rest.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import { crossOrganizationScope } from '../../server/storage/scope.js';
import { up as migrate093 } from '../../server/db/migrations/093_access_attempt_retention.js';
import {
  ACCESS_ATTEMPT_WINDOW_MS,
  deleteOldAccessAttempts,
} from '../../server/storage/access-attempts.js';
import {
  ACCESS_TYPES,
  notifyAuthorOfAccessAttempt,
} from '../../server/services/access-notifications.js';

const AUTHOR = 'author@example.com';
const IP = '203.0.113.7';
const MINUTE_MS = 60 * 1000;
const agoIso = (ms) => new Date(Date.now() - ms).toISOString();
const pastWindowIso = () => agoIso(ACCESS_ATTEMPT_WINDOW_MS + MINUTE_MS);
const insideWindowIso = () => agoIso(ACCESS_ATTEMPT_WINDOW_MS - MINUTE_MS);

/** Run the migration the way the runner does: one transaction. */
const runMigration = (db) => db.transaction().execute((trx) => migrate093(trx));

pgDescribe('revoked-link attempt retention (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let orgId;
  let deckId;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(
      db,
      'organizations',
      'presentations',
      'access_attempt_log',
      'user_notifications',
    );
    orgId = await seedDefaultOrganization(db);
    deckId = await seedPresentation(db, { title: 'Quarterly review' });
  });

  /** An attempt row as the storage layer wrote it before and after B785. */
  async function insertAttempt({
    attemptedAt,
    notified = true,
    organizationId = orgId,
  }) {
    const id = crypto.randomUUID();
    await db
      .insertInto('access_attempt_log')
      .values({
        id,
        organization_id: organizationId,
        presentation_id: organizationId === orgId ? deckId : null,
        access_type: ACCESS_TYPES.SHARE_LINK,
        accessor_ip: IP,
        attempted_at: attemptedAt,
        author_notified_at: notified ? attemptedAt : null,
      })
      .execute();
    return id;
  }

  async function insertNotification(type, data) {
    const id = crypto.randomUUID();
    await db
      .insertInto('user_notifications')
      .values({
        id,
        organization_id: orgId,
        user_email: AUTHOR,
        notification_type: type,
        title: 'A notification',
        data: JSON.stringify(data),
      })
      .execute();
    return id;
  }

  const attemptIds = async () =>
    (await db.selectFrom('access_attempt_log').select('id').execute())
      .map((r) => r.id)
      .sort();

  const notificationData = async (id) =>
    (
      await db
        .selectFrom('user_notifications')
        .select('data')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).data;

  it('migration 093 clears the backlog and strips the IP key from access_attempt notifications only', async () => {
    await insertAttempt({ attemptedAt: pastWindowIso() });
    await insertAttempt({ attemptedAt: pastWindowIso(), notified: false });
    const young = await insertAttempt({ attemptedAt: insideWindowIso() });
    const legacy = await insertNotification('access_attempt', {
      accessType: 'share_link',
      accessorIp: IP,
      presentationTitle: 'Quarterly review',
    });
    const clean = await insertNotification('access_attempt', {
      accessType: 'share_link',
      presentationTitle: 'Other deck',
    });
    const comment = await insertNotification('comment_mention', {
      commentId: 'c-1',
      accessorIp: 'not ours to touch',
    });

    await runMigration(db);

    assert.deepEqual(await attemptIds(), [young]);
    assert.deepEqual(await notificationData(legacy), {
      accessType: 'share_link',
      presentationTitle: 'Quarterly review',
    });
    assert.deepEqual(await notificationData(clean), {
      accessType: 'share_link',
      presentationTitle: 'Other deck',
    });
    assert.deepEqual(await notificationData(comment), {
      commentId: 'c-1',
      accessorIp: 'not ours to touch',
    });

    await runMigration(db);
    assert.deepEqual(await attemptIds(), [young]);
    assert.deepEqual(await notificationData(legacy), {
      accessType: 'share_link',
      presentationTitle: 'Quarterly review',
    });
  });

  it('writes one notified record per notification, none for a suppressed attempt, and no IP in the notification', async () => {
    const scope = testScope();
    const attempt = () =>
      notifyAuthorOfAccessAttempt({
        presentationId: deckId,
        presentationTitle: 'Quarterly review',
        authorEmail: AUTHOR,
        accessType: ACCESS_TYPES.SHARE_LINK,
        accessorIp: IP,
        scope,
      });

    assert.deepEqual(await attempt(), { ok: true, notified: true });
    assert.deepEqual(await attempt(), {
      ok: true,
      notified: false,
      reason: 'rate_limited',
    });

    const attempts = await db
      .selectFrom('access_attempt_log')
      .selectAll()
      .execute();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].accessor_ip, IP);
    assert.ok(attempts[0].author_notified_at instanceof Date);

    const notifications = await db
      .selectFrom('user_notifications')
      .selectAll()
      .execute();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].notification_type, 'access_attempt');
    assert.deepEqual(notifications[0].data, {
      accessType: 'share_link',
      presentationTitle: 'Quarterly review',
    });
  });

  it('deleteOldAccessAttempts removes rows past the window across organizations and keeps the rest', async () => {
    const otherOrg = crypto.randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: otherOrg, name: 'Other', slug: 'other-org' })
      .execute();
    await insertAttempt({ attemptedAt: pastWindowIso() });
    await insertAttempt({
      attemptedAt: pastWindowIso(),
      organizationId: otherOrg,
    });
    const youngA = await insertAttempt({ attemptedAt: insideWindowIso() });
    const youngB = await insertAttempt({
      attemptedAt: agoIso(MINUTE_MS),
      organizationId: otherOrg,
    });

    const result = await deleteOldAccessAttempts(
      crossOrganizationScope(null, 'test: instance retention'),
      agoIso(ACCESS_ATTEMPT_WINDOW_MS),
    );

    assert.deepEqual(result, { deleted: 2 });
    assert.deepEqual(await attemptIds(), [youngA, youngB].sort());
  });
});
