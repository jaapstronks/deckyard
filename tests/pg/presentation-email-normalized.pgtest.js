/**
 * One fold, on the write side, against real PostgreSQL (B392, D200).
 *
 * `presentations.owner_email` is read in four places, and since this change
 * all four compare it bare against an address that went through
 * `normalizeEmail` once:
 *
 *  1. `getSandboxUsageForOwner` (sandbox-quota.js), which used to fold a second
 *     time in SQL with `lower(owner_email)`;
 *  2. the analytics dashboard's owned-deck lookup (dashboard.js);
 *  3. the weekly summary's owned-deck lookup (weekly-summary.js);
 *  4. the weekly team summary's join `users.email = presentations.owner_email`.
 *
 * That is only safe when no stored row is left un-normalised, which is what
 * migration 091 does for rows written before the create path normalised. So
 * every case seeds a deck with a mixed-case, padded owner the way the old
 * create wrote it, runs the migration, and asks each read site with a
 * mixed-case address: it has to find the same deck.
 *
 * The write half (the create and update paths normalise) is covered DB-lessly
 * in tests/presentation-email-normalized-write.test.js.
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';
import {
  EMAIL_COLUMNS,
  countUnnormalized,
  up as normalizePresentationEmails,
} from '../../server/db/migrations/091_presentation_email_normalized.js';
import { getSandboxUsageForOwner } from '../../server/storage/presentations/sandbox-quota.js';
import { getPresentationsWithAnalytics } from '../../server/storage/analytics/index.js';
import {
  getTeamWeeklyAnalytics,
  getWeeklyAnalyticsForUser,
} from '../../server/storage/analytics/weekly-summary.js';

const ANN = 'ann@example.com';
const LEGACY_ANN = '  Ann@Example.COM ';
const ASKED_AS = ' ANN@example.Com ';

/**
 * Run the migration the way the runner does: one transaction.
 * @param {import('kysely').Kysely<any>} db
 */
const runMigration = (db) =>
  db.transaction().execute((trx) => normalizePresentationEmails(trx));

pgDescribe('presentation e-mail normalised on write (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;
  let orgId;
  let annId;
  let legacyDeck;
  let otherDeck;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  /**
   * Insert a deck with the e-mail stamps exactly as given, bypassing the
   * facade: the point is a row as the pre-D200 create wrote it.
   */
  async function insertDeck(email, title) {
    const id = crypto.randomUUID();
    await db
      .insertInto('presentations')
      .values({
        id,
        organization_id: orgId,
        owner_email: email,
        created_by: email,
        updated_by: email,
        title,
        slides: JSON.stringify([]),
        i18n: JSON.stringify({}),
      })
      .execute();
    return id;
  }

  /** One viewing session on a deck, an hour ago (inside the weekly window). */
  async function seedSession(presentationId) {
    const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await db
      .insertInto('view_sessions')
      .values({
        presentation_id: presentationId,
        session_token: crypto.randomBytes(32).toString('hex'),
        source_type: 'share_link',
        viewer_type: 'anonymous',
        device_id: crypto.randomUUID(),
        started_at: at,
        last_activity_at: at,
        duration_seconds: 60,
      })
      .execute();
  }

  beforeEach(async () => {
    await truncate(db, 'organizations', 'users');
    orgId = await seedDefaultOrganization(db);
    annId = crypto.randomUUID();
    await db
      .insertInto('users')
      .values({
        id: annId,
        organization_id: orgId,
        email: ANN,
        name: 'Ann Example',
        role: 'user',
      })
      .execute();
    legacyDeck = await insertDeck(LEGACY_ANN, 'Legacy');
    otherDeck = await insertDeck('bob@example.com', 'Bob');
    await seedSession(legacyDeck);
    await seedSession(otherDeck);
  });

  it('the migration counts and normalises the legacy rows, once', async () => {
    for (const column of EMAIL_COLUMNS) {
      assert.equal(await countUnnormalized(db, column), 1, column);
    }
    const blank = await insertDeck('   ', 'Blank');

    await runMigration(db);

    const rows = await db
      .selectFrom('presentations')
      .select(['id', 'owner_email', 'created_by', 'updated_by'])
      .execute();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const column of EMAIL_COLUMNS) {
      assert.equal(byId[legacyDeck][column], ANN, column);
      assert.equal(byId[otherDeck][column], 'bob@example.com', column);
      assert.equal(byId[blank][column], null, `${column}: blank is NULL`);
      assert.equal(await countUnnormalized(db, column), 0, column);
    }

    // A second run finds nothing left to do.
    await runMigration(db);
  });

  it('1. the sandbox quota finds the deck from a mixed-case address', async () => {
    await runMigration(db);
    const usage = await getSandboxUsageForOwner(
      { organizationId: getDefaultOrganizationId() },
      ASKED_AS,
    );
    assert.equal(usage.deckCount, 1);
  });

  it('2. the analytics dashboard finds the deck from a mixed-case address', async () => {
    await runMigration(db);
    const { presentations } = await getPresentationsWithAnalytics(
      { organizationId: orgId },
      ASKED_AS,
      orgId,
      { period: '30d' },
    );
    assert.deepEqual(
      presentations.map((p) => p.id),
      [legacyDeck],
    );
  });

  it('3. the weekly summary finds the deck from a mixed-case address', async () => {
    await runMigration(db);
    const weekly = await getWeeklyAnalyticsForUser(
      { organizationId: orgId },
      annId,
      ASKED_AS,
    );
    assert.equal(weekly.presentationCount, 1);
    assert.equal(weekly.totalViews, 1);
  });

  it('4. the weekly team summary joins the owner to their user row', async () => {
    await runMigration(db);
    const team = await getTeamWeeklyAnalytics({ organizationId: orgId }, orgId);
    const ann = team.topPresenters.find((p) => p.email === ANN);
    assert.ok(ann, 'the legacy owner is one presenter, not a stray address');
    assert.equal(ann.name, 'Ann Example', 'resolved through users.email');
    assert.equal(team.activePresenters, 2);
  });
});
