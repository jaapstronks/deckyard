/**
 * The dual-key write path: `presentation_collaborators.user_id` (T10, PR 2).
 *
 * Migration 062 adds a nullable `user_id` beside `user_email`, and
 * `addCollaborator` (server/storage/collaborators.js) now populates it via the
 * identity resolver. This file pins what that write does against real
 * PostgreSQL, on the column the reads still do NOT use:
 *
 *   - a **known** user's email writes their stable `users.id`;
 *   - an **external** collaborator (no `users` row) writes `NULL` — the pinned
 *     external path (tests/pg/collaborator-authz-resolution.pgtest.js) must
 *     keep working, and its `user_id` is defined-NULL, not an error;
 *   - **revoke → re-add** (the reactivate branch) restores the correct
 *     `user_id`, including the case where someone was external at first invite
 *     and has since become a real user.
 *
 * Behaviour-preservation is pinned elsewhere: the authz matrix and the
 * email-keyed resolution are unchanged by PR 2 and stay green in
 * authz-matrix-pin.test.js and collaborator-authz-resolution.pgtest.js. This
 * file only proves the new column is filled correctly.
 *
 * Runs only against a throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import {
  addCollaborator,
  removeCollaborator,
} from '../../server/storage/collaborators.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

// The seeded org owns the deck, and that is now the only organization in play:
// the collaborator functions read it off the presentation rather than taking it
// from a caller (see the header of server/storage/collaborators.js).
const ORG = getDefaultOrganizationId();
const PID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const OWNER_EMAIL = 'owner@example.com';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const MEMBER_EMAIL = 'member@example.com';
const MEMBER_ID = '22222222-2222-2222-2222-222222222222';

pgDescribe('collaborator user_id dual-key write (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await db
      .insertInto('organizations')
      .values({ id: ORG, name: 'Default', slug: 'default' })
      .execute();
    await db
      .insertInto('users')
      .values([
        {
          id: OWNER_ID,
          organization_id: ORG,
          email: OWNER_EMAIL,
          name: 'Owner',
          role: 'user',
        },
        {
          id: MEMBER_ID,
          organization_id: ORG,
          email: MEMBER_EMAIL,
          name: 'Member',
          role: 'user',
        },
      ])
      .execute();
    await db
      .insertInto('presentations')
      .values({
        id: PID,
        organization_id: ORG,
        title: 'Deck',
        owner_email: OWNER_EMAIL,
        created_by: OWNER_EMAIL,
        visibility: 'private',
      })
      .execute();
  });

  /** The stored user_id for the active row of `email` on the seeded deck. */
  async function storedUserId(email) {
    const row = await db
      .selectFrom('presentation_collaborators')
      .select('user_id')
      .where('presentation_id', '=', PID)
      .where('user_email', '=', email)
      .where('organization_id', '=', ORG)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return row ? row.user_id : undefined;
  }

  it("writes the known user's stable users.id", async () => {
    const added = await addCollaborator(PID, {
      userEmail: MEMBER_EMAIL,
      permission: 'edit',
    });
    assert.equal(added.ok, true);
    assert.equal(await storedUserId(MEMBER_EMAIL), MEMBER_ID);
  });

  it('writes NULL for an external collaborator (no users row)', async () => {
    const email = 'external-partner@agency.test'; // deliberately NOT in `users`
    const added = await addCollaborator(PID, {
      userEmail: email,
      permission: 'edit',
    });
    assert.equal(added.ok, true);
    assert.equal(await storedUserId(email), null);
  });

  it('restores the correct user_id on revoke → re-add (reactivate)', async () => {
    await addCollaborator(PID, { userEmail: MEMBER_EMAIL, permission: 'view' });
    assert.equal(await storedUserId(MEMBER_EMAIL), MEMBER_ID);

    const removed = await removeCollaborator(
      PID,
      MEMBER_EMAIL,
      OWNER_EMAIL,
      {},
    );
    assert.equal(removed.ok, true);

    const readded = await addCollaborator(PID, {
      userEmail: MEMBER_EMAIL,
      permission: 'admin',
    });
    assert.equal(readded.ok, true);
    assert.equal(readded.reactivated, true);
    assert.equal(await storedUserId(MEMBER_EMAIL), MEMBER_ID);
  });

  it('links the user_id on reactivate when an external invite later becomes a user', async () => {
    const email = 'late-signup@example.com';

    // First invited as an external collaborator: no users row yet → NULL.
    await addCollaborator(PID, { userEmail: email, permission: 'view' });
    assert.equal(await storedUserId(email), null);

    await removeCollaborator(PID, email, OWNER_EMAIL, {});

    // They sign up — a users row now exists for that email.
    const lateId = '33333333-3333-3333-3333-333333333333';
    await db
      .insertInto('users')
      .values({
        id: lateId,
        organization_id: ORG,
        email,
        name: 'Late',
        role: 'user',
      })
      .execute();

    // Re-adding resolves the freshly-created id instead of staying NULL.
    const readded = await addCollaborator(PID, {
      userEmail: email,
      permission: 'edit',
    });
    assert.equal(readded.reactivated, true);
    assert.equal(await storedUserId(email), lateId);
  });
});
