/**
 * `updateUserEventRead` against real PostgreSQL.
 *
 * The upsert writes the per-user "last read" marker for the activity feed
 * (server/storage/activity-events.js): an INSERT ... ON CONFLICT
 * (organization_id, user_email) DO UPDATE. Two things only a real database
 * proves here:
 *  - the conflict target is the composite unique index
 *    `(organization_id, user_email)` (migration 009), enforced by the
 *    constraint rather than a hand model, so a second write for the same
 *    (org, user) updates in place instead of adding a row;
 *  - `last_read_event_id` is a real FK to `activity_events(id)` — a bad id is
 *    rejected, and ON DELETE SET NULL means deleting the referenced event
 *    nulls the marker rather than orphaning it.
 */

import crypto from 'node:crypto';

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createActivityEvent,
  updateUserEventRead,
  ENTITY_TYPES,
  EVENT_TYPES,
} from '../../server/storage/activity-events.js';

const ctx = testScope();
const ALICE = 'alice@example.com';

/** Seed one activity event and return its id (for the last_read_event_id FK). */
async function seedEvent() {
  const res = await createActivityEvent(ctx, {
    eventType: EVENT_TYPES.PRESENTATION_CREATED,
    entityType: ENTITY_TYPES.PRESENTATION,
    // entity_id is a NOT NULL uuid column (no FK); any uuid is valid.
    entityId: crypto.randomUUID(),
    actorEmail: ALICE,
  });
  assert.equal(res.ok, true);
  return res.event.id;
}

pgDescribe('updateUserEventRead (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  const readRows = () =>
    db
      .selectFrom('user_event_reads')
      .select(['user_email', 'last_read_event_id'])
      .where('user_email', '=', ALICE)
      .execute();

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    // CASCADE clears activity_events + user_event_reads under the org.
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
  });

  it('inserts a fresh marker on the first read', async () => {
    const res = await updateUserEventRead(ctx, ALICE, null);
    assert.equal(res.ok, true);

    const rows = await readRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].last_read_event_id, null);
  });

  it('updates in place on the (organization_id, user_email) conflict', async () => {
    const eventId = await seedEvent();

    await updateUserEventRead(ctx, ALICE, null);
    const res = await updateUserEventRead(ctx, ALICE, eventId);
    assert.equal(res.ok, true);

    // Still one row for (org, alice); the second write moved the marker.
    const rows = await readRows();
    assert.equal(rows.length, 1, 'exactly one marker per (org, user)');
    assert.equal(rows[0].last_read_event_id, eventId);
  });

  it('nulls the marker when the referenced event is deleted (FK SET NULL)', async () => {
    const eventId = await seedEvent();
    await updateUserEventRead(ctx, ALICE, eventId);

    await db.deleteFrom('activity_events').where('id', '=', eventId).execute();

    const rows = await readRows();
    assert.equal(rows.length, 1, 'the marker survives the event deletion');
    assert.equal(
      rows[0].last_read_event_id,
      null,
      'but its FK is nulled, not orphaned',
    );
  });
});
