/**
 * Migration 094 drops `share_link_access_log`, against real PostgreSQL (B784).
 *
 * The verification log had no reader; the write and the route went first, the
 * table goes with this migration. The fake-db double has no schema builder, so
 * `tests/share-link-access-log-drop-migration.test.js` can only pin which
 * statements the migration issues. What it cannot show is that PostgreSQL
 * accepts them on a migrated database: that the table, its rows and its index
 * are really gone, that `down` brings back the empty 004 shape (foreign key
 * with cascade included), and that both directions can run twice.
 *
 * The suite runs on a database migrated up to 094, so the table starts absent
 * and the last step leaves it absent again.
 *
 * Run with: DATABASE_URL=… node --test tests/pg/share-link-access-log-drop.pgtest.js
 */

import { after, before, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { sql } from 'kysely';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import {
  up,
  down,
} from '../../server/db/migrations/094_drop_share_link_access_log.js';

/** Run a migration direction the way the runner does: one transaction. */
const run = (db, fn) => db.transaction().execute((trx) => fn(trx));

/** Whether a relation (table or index) exists in the public schema. */
async function exists(db, name) {
  const { rows } =
    await sql`SELECT to_regclass(${`public.${name}`}) AS present`.execute(db);
  return rows[0]?.present != null;
}

pgDescribe('share-link access log drop (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    // Leave the schema as the migrations leave it, whatever a test did.
    if (db) await run(db, up);
    await closeTestDb(db);
  });

  it('a migrated database has no access log table and no index', async () => {
    assert.equal(await exists(db, 'share_link_access_log'), false);
    assert.equal(await exists(db, 'idx_access_log_link'), false);
  });

  it('down restores the empty 004 shape, up drops it with its rows, and both run twice', async () => {
    await run(db, down);
    await run(db, down);
    assert.equal(await exists(db, 'share_link_access_log'), true);
    assert.equal(await exists(db, 'idx_access_log_link'), true);

    // The restored table keeps the cascade from its link, as 004 made it.
    await truncate(db, 'organizations', 'presentations');
    const orgId = await seedDefaultOrganization(db);
    const deckId = await seedPresentation(db);
    const linkId = crypto.randomUUID();
    await db
      .insertInto('presentation_share_links')
      .values({
        id: linkId,
        presentation_id: deckId,
        organization_id: orgId,
        token: crypto.randomBytes(16).toString('hex'),
        permission: 'view',
      })
      .execute();
    await db
      .insertInto('share_link_access_log')
      .values({
        share_link_id: linkId,
        ip_address: '203.0.113.7',
        user_agent: 'test-agent/1.0',
      })
      .execute();
    await db
      .deleteFrom('presentation_share_links')
      .where('id', '=', linkId)
      .execute();
    const { rows } =
      await sql`SELECT count(*)::int AS n FROM share_link_access_log`.execute(
        db,
      );
    assert.equal(rows[0].n, 0, 'deleting the link cascades to its log');

    // A row present at upgrade time goes with the table.
    await db
      .insertInto('presentation_share_links')
      .values({
        id: linkId,
        presentation_id: deckId,
        organization_id: orgId,
        token: crypto.randomBytes(16).toString('hex'),
        permission: 'view',
      })
      .execute();
    await db
      .insertInto('share_link_access_log')
      .values({ share_link_id: linkId, ip_address: '203.0.113.7' })
      .execute();

    await run(db, up);
    await run(db, up);
    assert.equal(await exists(db, 'share_link_access_log'), false);
    assert.equal(await exists(db, 'idx_access_log_link'), false);
    const link = await db
      .selectFrom('presentation_share_links')
      .select('id')
      .where('id', '=', linkId)
      .executeTakeFirst();
    assert.equal(link?.id, linkId, 'the link itself is untouched');
  });
});
