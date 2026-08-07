/**
 * The dual-key write path: `presentations` ownership id columns (T10, PR 3).
 *
 * Migration 063 adds `owner_user_id`, `created_by_user_id` and
 * `updated_by_user_id` beside `owner_email`/`created_by`/`updated_by`, and the
 * PostgreSQL adapter (server/storage/adapters/postgres/presentations.js) now
 * populates them via the identity resolver. This file pins what those writes do
 * against real PostgreSQL, on the columns the reads still do NOT use:
 *
 *   - **create** stamps all three id columns from the owner (who is also the
 *     creator and last writer at create): a **known** owner writes their stable
 *     `users.id`, an owner with **no users row** writes `NULL` — the pinned
 *     external/legacy path (tests/pg/collaborator-authz-resolution.pgtest.js);
 *   - **update** stamps `updated_by_user_id` from the same actor it writes to
 *     `updated_by`, and — the behaviour this PR deliberately pins — touches
 *     **neither** `owner_user_id` **nor** `created_by_user_id`. The PG update
 *     path never rewrites `owner_email`/`created_by` today (ownership transfer's
 *     owner_email persistence is a pre-existing PG gap, tracked as its own item
 *     — brief § PR 3), so the id columns must mirror that: owner and creator
 *     stay put across an edit.
 *
 * Behaviour-preservation is pinned elsewhere: the authz matrix and the
 * email-keyed resolution are unchanged by PR 3 and stay green in
 * authz-matrix-pin.test.js and collaborator-authz-resolution.pgtest.js. This
 * file proves the new columns are filled correctly and that an edit leaves the
 * owner/creator identity alone.
 *
 * The **ownership-transfer** section then pins the one deliberate behaviour
 * change on top of PR 3 (the transfer-gap fix): a transfer opens the
 * `allowOwnerChange` gate and moves `owner_email` and `owner_user_id` in one
 * statement — both columns for a known new owner, email-only (id NULL) for an
 * external one — while a plain update that merely names an `ownerEmail` still
 * cannot touch the owner.
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
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPresentation,
  updatePresentation,
} from '../../server/storage/presentations/index.js';
import { transferPresentationOwnership } from '../../server/storage/presentations/ownership.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

const ORG = getDefaultOrganizationId();
const storageScope = testScope();

const OWNER_EMAIL = 'owner@example.com';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
const MEMBER_EMAIL = 'member@example.com';
const MEMBER_ID = '22222222-2222-2222-2222-222222222222';

pgDescribe('presentation owner user_id dual-key write (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  beforeEach(async () => {
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    await db
      .insertInto('users')
      .values([
        { id: OWNER_ID, organization_id: ORG, email: OWNER_EMAIL, name: 'Owner', role: 'user' },
        { id: MEMBER_ID, organization_id: ORG, email: MEMBER_EMAIL, name: 'Member', role: 'user' },
      ])
      .execute();
  });

  /** The three id columns and the email columns of a stored deck. */
  async function storedRow(pid) {
    return db
      .selectFrom('presentations')
      .select([
        'owner_email',
        'created_by',
        'updated_by',
        'owner_user_id',
        'created_by_user_id',
        'updated_by_user_id',
      ])
      .where('id', '=', pid)
      .executeTakeFirst();
  }

  it("create stamps the owner's stable users.id into all three id columns", async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: OWNER_EMAIL });
    const row = await storedRow(pres.id);

    // Email columns unchanged (behaviour-preserving); id columns filled from them.
    assert.equal(row.owner_email, OWNER_EMAIL);
    assert.equal(row.owner_user_id, OWNER_ID);
    assert.equal(row.created_by_user_id, OWNER_ID);
    assert.equal(row.updated_by_user_id, OWNER_ID);
  });

  it('create leaves all three id columns NULL when the owner has no users row', async () => {
    const email = 'nobody@external.test'; // deliberately NOT in `users`
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: email });
    const row = await storedRow(pres.id);

    // The email is still written — the external/legacy path stays first-class.
    assert.equal(row.owner_email, email);
    assert.equal(row.owner_user_id, null);
    assert.equal(row.created_by_user_id, null);
    assert.equal(row.updated_by_user_id, null);
  });

  it('an update stamps updated_by_user_id from the actor and touches neither owner nor created_by id', async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: OWNER_EMAIL });

    // A different user edits the deck.
    await updatePresentation(storageScope, pres.id, { title: 'Edited' }, { actorEmail: MEMBER_EMAIL });
    const row = await storedRow(pres.id);

    // updated_by (email) and updated_by_user_id both move to the editor.
    assert.equal(row.updated_by, MEMBER_EMAIL);
    assert.equal(row.updated_by_user_id, MEMBER_ID);
    // The owner and creator — email and id — are untouched by an edit.
    assert.equal(row.owner_email, OWNER_EMAIL);
    assert.equal(row.owner_user_id, OWNER_ID);
    assert.equal(row.created_by_user_id, OWNER_ID);
  });

  it('an update by an external actor leaves updated_by_user_id NULL and still does not touch the owner columns', async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: OWNER_EMAIL });

    await updatePresentation(storageScope, pres.id, { title: 'Edited' }, { actorEmail: 'ext@external.test' });
    const row = await storedRow(pres.id);

    assert.equal(row.updated_by, 'ext@external.test');
    assert.equal(row.updated_by_user_id, null); // no users row → NULL, not an error
    // Owner/creator identity still intact.
    assert.equal(row.owner_user_id, OWNER_ID);
    assert.equal(row.created_by_user_id, OWNER_ID);
  });

  // --- Ownership transfer: the gated owner write (transfer-gap fix) ---------
  //
  // The update path drops `ownerEmail` unless `allowOwnerChange` is set, so a
  // transfer used to return ok yet persist nothing in Postgres mode. These pin
  // the fix: `transferPresentationOwnership` opens the gate and the paired owner
  // keys move in one statement — a known new owner writes both columns, an
  // external one moves the email and leaves the id NULL — while a plain update
  // that merely names an `ownerEmail` (no gate) still cannot touch the owner.

  it('transfer to a known member moves owner_email and owner_user_id together, leaving creator intact', async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: OWNER_EMAIL });

    const result = await transferPresentationOwnership(
      null,
      pres.id,
      { newOwnerEmail: MEMBER_EMAIL, previousOwnerEmail: OWNER_EMAIL, actorEmail: OWNER_EMAIL },
      storageScope
    );
    assert.equal(result.ok, true);

    const row = await storedRow(pres.id);
    // Both owner keys followed the new owner, resolved from one address.
    assert.equal(row.owner_email, MEMBER_EMAIL);
    assert.equal(row.owner_user_id, MEMBER_ID);
    // Creator is create-only and untouched by a transfer.
    assert.equal(row.created_by, OWNER_EMAIL);
    assert.equal(row.created_by_user_id, OWNER_ID);
    // The actor performing the transfer is the last writer.
    assert.equal(row.updated_by, OWNER_EMAIL);
    assert.equal(row.updated_by_user_id, OWNER_ID);
  });

  it('transfer to an external email moves owner_email but leaves owner_user_id NULL', async () => {
    const external = 'newowner@external.test'; // deliberately NOT in `users`
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: OWNER_EMAIL });

    const result = await transferPresentationOwnership(
      null,
      pres.id,
      { newOwnerEmail: external, previousOwnerEmail: OWNER_EMAIL, actorEmail: OWNER_EMAIL },
      storageScope
    );
    assert.equal(result.ok, true);

    const row = await storedRow(pres.id);
    // Email moves; the id column stays NULL — the pinned external/legacy path.
    assert.equal(row.owner_email, external);
    assert.equal(row.owner_user_id, null);
    // Creator untouched.
    assert.equal(row.created_by_user_id, OWNER_ID);
  });

  it('a plain update naming ownerEmail (no allowOwnerChange gate) leaves the owner columns untouched', async () => {
    const pres = await createPresentation(storageScope, { title: 'Deck', ownerEmail: OWNER_EMAIL });

    // An ordinary editor save that happens to carry ownerEmail must NOT move
    // the owner — only the gated transfer route may. This pins the gate itself.
    await updatePresentation(
      storageScope,
      pres.id,
      { title: 'Edited', ownerEmail: MEMBER_EMAIL },
      { actorEmail: OWNER_EMAIL }
    );

    const row = await storedRow(pres.id);
    assert.equal(row.owner_email, OWNER_EMAIL);
    assert.equal(row.owner_user_id, OWNER_ID);
  });
});
