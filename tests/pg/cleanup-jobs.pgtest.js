/**
 * B686: cleanup jobs against stored PostgreSQL rows, including exact cutoffs.
 * Run with: DATABASE_URL=postgres://…/deckyard_pg_tests npm run test:pg
 */
import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { writeAppSettings } from '../../server/storage/settings.js';
import { testScope } from '../helpers/storage-scope.js';

const execFileAsync = promisify(execFile);
const NOW = Date.parse('2026-01-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const IP = '192.0.2.10';
const at = (daysAgo, offsetMs = 0) =>
  new Date(NOW - daysAgo * DAY + offsetMs).toISOString();

/**
 * Run the private one-shot job through its existing CLI entry point. A child
 * gives the CLI ownership of process.exit and a frozen Date without affecting
 * the test runner or PostgreSQL's clock. The harness injects only DATABASE_URL.
 * Completion and failure are observed through the exit status, not polling.
 * @param {'analytics'|'auth'} job
 * @returns {Promise<string>}
 */
async function runCleanup(job) {
  const harness = new URL('./helpers/harness.js', import.meta.url).href;
  const target = new URL(
    `../../server/jobs/${job}-cleanup.js`,
    import.meta.url,
  );
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import { mock } from 'node:test';
        import { openTestDb } from ${JSON.stringify(harness)};
        await openTestDb();
        mock.timers.enable({ apis: ['Date'], now: ${NOW} });
        process.argv[1] = ${JSON.stringify(target.pathname)};
        await import(${JSON.stringify(target.href)});
      `,
    ],
    { env: { ...process.env, TZ: 'UTC' }, timeout: 30_000 },
  );
  return stdout;
}

pgDescribe('retention cleanup jobs (real PostgreSQL)', () => {
  let db;
  let presentationId;

  before(async () => {
    db = await openTestDb();
  });
  after(async () => {
    await closeTestDb(db);
  });
  beforeEach(async () => {
    await truncate(
      db,
      'organizations',
      'app_settings',
      'magic_link_tokens',
      'password_reset_tokens',
      'auth_audit_log',
    );
    await seedDefaultOrganization(db);
    presentationId = await seedPresentation(db);
  });

  async function policy(sessionDataDays, ipAnonymizationDays) {
    await writeAppSettings(testScope(), {
      analytics: { retention: { sessionDataDays, ipAnonymizationDays } },
    });
  }

  async function session(createdAt, ip = IP) {
    const { id } = await db
      .insertInto('view_sessions')
      .values({
        presentation_id: presentationId,
        session_token: crypto.randomUUID(),
        source_type: 'share_link',
        viewer_type: 'anonymous',
        // Activity timestamps deliberately differ from the retention clock.
        started_at: at(0),
        last_activity_at: at(0),
        created_at: createdAt,
        ip_address: ip,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async function slide(viewSessionId, createdAt) {
    const { id } = await db
      .insertInto('slide_views')
      .values({
        presentation_id: presentationId,
        view_session_id: viewSessionId,
        slide_id: crypto.randomUUID(),
        slide_index: 0,
        entered_at: at(0),
        created_at: createdAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  }

  async function ids(table) {
    return (
      await db.selectFrom(table).select('id').orderBy('id').execute()
    ).map((row) => row.id);
  }

  it('uses configured cutoffs, retaining exact-boundary sessions and IPs', async () => {
    await policy(30, 3);
    const expired = await session(at(30, -1));
    const deletionBoundary = await session(at(30));
    const anonymize = await session(at(3, -1));
    const ipBoundary = await session(at(3));
    const fresh = await session(at(0));
    const alreadyAnonymous = await session(at(4), null);
    await slide(expired, at(30, -1));
    const oldSlideOnKeptSession = await slide(fresh, at(30, -1));
    const keptSlide = await slide(deletionBoundary, at(30));
    const freshSlide = await slide(fresh, at(0));

    const output = await runCleanup('analytics');
    assert.match(output, /Deleted 1 sessions and 2 slide views/);
    assert.match(output, /Anonymized 3 IP addresses/);
    assert.deepEqual(
      await db
        .selectFrom('view_sessions')
        .select(['id', 'ip_address'])
        .orderBy('id')
        .execute(),
      [
        { id: deletionBoundary, ip_address: null },
        { id: anonymize, ip_address: null },
        { id: ipBoundary, ip_address: IP },
        { id: fresh, ip_address: IP },
        { id: alreadyAnonymous, ip_address: null },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.deepEqual(await ids('slide_views'), [keptSlide, freshSlide].sort());
    assert.ok(!(await ids('slide_views')).includes(oldSlideOnKeptSession));
    assert.match(await runCleanup('analytics'), /Anonymized 0 IP addresses/);
  });

  it('reads changed settings on the next pass and cascades children of deleted sessions', async () => {
    await policy(60, 20);
    const old = await session(at(15));
    const recent = await session(at(5));
    // A recent child must still disappear when its parent expires.
    await slide(old, at(0));
    const keptSlide = await slide(recent, at(0));
    assert.match(
      await runCleanup('analytics'),
      /Deleted 0 sessions and 0 slide views/,
    );
    assert.deepEqual(await ids('view_sessions'), [old, recent].sort());

    await policy(10, 2);
    const output = await runCleanup('analytics');
    assert.match(output, /Deleted 1 sessions and 0 slide views/);
    assert.match(output, /Anonymized 2 IP addresses/);
    assert.deepEqual(await ids('view_sessions'), [recent]);
    assert.deepEqual(await ids('slide_views'), [keptSlide]);
    const row = await db
      .selectFrom('view_sessions')
      .select('ip_address')
      .executeTakeFirstOrThrow();
    assert.equal(row.ip_address, null);
  });

  it('removes expired auth tokens regardless of use, preserving unexpired tokens and 90-day audit boundaries', async () => {
    for (const table of ['magic_link_tokens', 'password_reset_tokens']) {
      await db
        .insertInto(table)
        .values(
          [
            {
              token_hash: 'expired-unused',
              expires_at: at(0, -1),
              used_at: null,
            },
            { token_hash: 'expired-used', expires_at: at(1), used_at: at(2) },
            { token_hash: 'boundary', expires_at: at(0), used_at: null },
            { token_hash: 'future-unused', expires_at: at(-1), used_at: null },
            { token_hash: 'future-used', expires_at: at(-1), used_at: at(1) },
          ].map((row) => ({
            ...row,
            user_email: 'user@example.test',
            created_at: at(100),
          })),
        )
        .execute();
    }
    await db
      .insertInto('auth_audit_log')
      .values([
        { event_type: 'expired', created_at: at(90, -1) },
        { event_type: 'boundary', created_at: at(90) },
        { event_type: 'fresh', created_at: at(0) },
      ])
      .execute();

    const output = await runCleanup('auth');
    assert.match(output, /Magic link tokens deleted: 2/);
    assert.match(output, /Password reset tokens deleted: 2/);
    assert.match(output, /Audit log entries deleted: 1/);
    for (const table of ['magic_link_tokens', 'password_reset_tokens']) {
      const rows = await db
        .selectFrom(table)
        .select(['token_hash', 'used_at'])
        .orderBy('token_hash')
        .execute();
      assert.deepEqual(
        rows.map((row) => row.token_hash),
        ['boundary', 'future-unused', 'future-used'],
      );
      assert.equal(rows[2].used_at.toISOString(), at(1));
    }
    assert.deepEqual(
      await db
        .selectFrom('auth_audit_log')
        .select('event_type')
        .orderBy('event_type')
        .execute(),
      [{ event_type: 'boundary' }, { event_type: 'fresh' }],
    );
    const rerun = await runCleanup('auth');
    assert.match(rerun, /Magic link tokens deleted: 0/);
    assert.match(rerun, /Password reset tokens deleted: 0/);
    assert.match(rerun, /Audit log entries deleted: 0/);
  });
});
