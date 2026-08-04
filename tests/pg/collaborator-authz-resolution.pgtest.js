/**
 * The backend-dependent authz seam, against real PostgreSQL (T10, PR 1).
 *
 * The authorization *deciders* are pure and pinned in tests/authz-matrix-pin.test.js.
 * They take a `collaboratorPermission` as input; in Postgres mode that input is
 * produced by `getCollaboratorPermission`, which reads `presentation_collaborators`.
 * This file pins that resolution — and its composition with the actor-access
 * checks the public API and MCP surfaces use — so the identity-decoupling epic
 * (docs/plans/briefs/identity-decoupling.md) can rebuild it onto `users.id`
 * behaviour-preservingly.
 *
 * It also pins the two facts the epic hinges on:
 *   - **collaboration does not require a user record**: an external collaborator
 *     (an email with no `users` row) still resolves a permission and still gets
 *     access. The rebuild must keep that path, which is why the resolver names
 *     the "external" state instead of failing (tests/identity-resolver.test.js).
 *   - the **identity resolver** maps a known email to its stable `users.id`
 *     against the real table, and an unknown email to a defined external identity.
 *
 * Runs only against a throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import { closeTestDb, openTestDb, pgDescribe, truncate } from './helpers/harness.js';
import {
  addCollaborator,
  removeCollaborator,
  updateCollaboratorPermission,
  getCollaboratorPermission,
} from '../../server/storage/collaborators.js';
import { canActorAccessPresentation } from '../../server/utils/presentation-authz/actor-access.js';
import { resolveIdentityByEmail } from '../../server/storage/identity-resolver.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

// The seeded org is the instance DEFAULT so the composed machine-client checks
// (canActorAccessPresentation) see the same workspace the deck is in. The
// collaborator lookups themselves no longer take an organization at all — a
// row is scoped by its deck, and `(presentation_id, user_email)` is the whole
// key (see the header of server/storage/collaborators.js).
const ORG = getDefaultOrganizationId();
const PID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const OWNER_EMAIL = 'owner@example.com';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';

pgDescribe('collaborator authz resolution + identity resolver (real PostgreSQL)', () => {
  /** @type {import('kysely').Kysely<any>} */
  let db;

  before(async () => {
    db = await openTestDb();
  });

  after(async () => {
    await closeTestDb(db);
  });

  beforeEach(async () => {
    // CASCADE clears collaborators and users under the org.
    await truncate(db, 'organizations');
    await db.insertInto('organizations').values({ id: ORG, name: 'Default', slug: 'default' }).execute();
    await db
      .insertInto('users')
      .values({ id: OWNER_ID, organization_id: ORG, email: OWNER_EMAIL, name: 'Owner', role: 'user' })
      .execute();
    await db
      .insertInto('presentations')
      .values({
        id: PID,
        organization_id: ORG,
        title: 'Deck',
        owner_email: OWNER_EMAIL,
        created_by: OWNER_EMAIL,
        scope: 'private',
      })
      .execute();
  });

  // --- getCollaboratorPermission resolves each level -----------------------

  for (const permission of ['view', 'comment', 'edit', 'admin']) {
    it(`resolves a ${permission} collaborator to '${permission}'`, async () => {
      // A distinct email per case keeps the in-memory permission cache from
      // colliding across tests; addCollaborator invalidates its own key.
      const email = `collab-${permission}@example.com`;
      const added = await addCollaborator(PID, { userEmail: email, permission });
      assert.equal(added.ok, true);

      assert.equal(await getCollaboratorPermission(PID, email), permission);
    });
  }

  it('returns null for someone who is not a collaborator', async () => {
    assert.equal(await getCollaboratorPermission(PID, 'stranger@example.com'), null);
  });

  it('returns null once a collaborator is revoked', async () => {
    const email = 'revoked@example.com';
    await addCollaborator(PID, { userEmail: email, permission: 'edit' });
    assert.equal(await getCollaboratorPermission(PID, email), 'edit');

    const removed = await removeCollaborator(PID, email, OWNER_EMAIL, {});
    assert.equal(removed.ok, true);
    assert.equal(await getCollaboratorPermission(PID, email), null);
  });

  it('reflects a permission update', async () => {
    const email = 'promoted@example.com';
    await addCollaborator(PID, { userEmail: email, permission: 'view' });
    await updateCollaboratorPermission(PID, email, 'admin');
    assert.equal(await getCollaboratorPermission(PID, email), 'admin');
  });

  it("stamps a new row with the deck's organization", async () => {
    // The write path used to stamp the *inviter's* session organization, which
    // could differ from the deck's and produced a grant that then resolved to
    // nothing. There is no session to stamp from any more: the organization is
    // read off the presentation, so the column and the deck cannot disagree.
    const otherOrg = '00000000-0000-0000-0000-0000000000bb';
    await db.insertInto('organizations').values({ id: otherOrg, name: 'Other', slug: 'other' }).execute();
    const email = 'stamped@example.com';
    await addCollaborator(PID, { userEmail: email, permission: 'edit' });

    const row = await db
      .selectFrom('presentation_collaborators')
      .select('organization_id')
      .where('presentation_id', '=', PID)
      .where('user_email', '=', email)
      .executeTakeFirstOrThrow();

    assert.equal(row.organization_id, ORG);
    assert.notEqual(row.organization_id, otherOrg);
  });

  it('resolves a row that carries a foreign organization stamp', async () => {
    // Exactly what the old write path left behind. The stamp is a denormalized
    // copy of the deck's organization, not part of the lookup, so such a row
    // grants what it says it grants instead of being silently inert.
    const otherOrg = '00000000-0000-0000-0000-0000000000cc';
    await db.insertInto('organizations').values({ id: otherOrg, name: 'Third', slug: 'third' }).execute();
    const email = 'legacy-stamp@example.com';
    await db
      .insertInto('presentation_collaborators')
      .values({
        presentation_id: PID,
        organization_id: otherOrg,
        user_email: email,
        permission: 'edit',
        invited_by: OWNER_EMAIL,
      })
      .execute();

    assert.equal(await getCollaboratorPermission(PID, email), 'edit');
  });

  it('refuses to invite onto a deck that does not exist', async () => {
    const result = await addCollaborator('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', {
      userEmail: 'nowhere@example.com',
      permission: 'view',
    });
    assert.deepEqual(result, { ok: false, reason: 'not_found' });
  });

  // --- Composed decision: resolution feeding the actor-access check --------

  it('an edit collaborator can read and write through canActorAccessPresentation', async () => {
    const email = 'editor@example.com';
    await addCollaborator(PID, { userEmail: email, permission: 'edit' });
    const pres = { id: PID, scope: 'private', ownerEmail: OWNER_EMAIL, organizationId: ORG };

    assert.equal(await canActorAccessPresentation(pres, email, 'read'), true);
    assert.equal(await canActorAccessPresentation(pres, email, 'write'), true);
  });

  it('a view collaborator can read but not write', async () => {
    const email = 'viewer@example.com';
    await addCollaborator(PID, { userEmail: email, permission: 'view' });
    const pres = { id: PID, scope: 'private', ownerEmail: OWNER_EMAIL, organizationId: ORG };

    assert.equal(await canActorAccessPresentation(pres, email, 'read'), true);
    assert.equal(await canActorAccessPresentation(pres, email, 'write'), false);
  });

  // --- The "external collaborator" path: ACL access without a user record --

  it('an external collaborator (no user row) still resolves a permission and gets access', async () => {
    const email = 'external-partner@agency.test'; // deliberately NOT in `users`
    await addCollaborator(PID, { userEmail: email, permission: 'edit' });
    const pres = { id: PID, scope: 'private', ownerEmail: OWNER_EMAIL, organizationId: ORG };

    assert.equal(await getCollaboratorPermission(PID, email), 'edit');
    assert.equal(await canActorAccessPresentation(pres, email, 'write'), true);

    // …and the resolver names them external rather than failing — this is the
    // seam the epic must preserve when ACL moves from email to user_id.
    const resolution = await resolveIdentityByEmail(email);
    assert.equal(resolution.userId, null);
    assert.equal(resolution.external, true);
    assert.equal(resolution.resolved, false);
  });

  // --- Identity resolver against the real users table ----------------------

  it('resolves a known owner email to its stable users.id', async () => {
    const resolution = await resolveIdentityByEmail(OWNER_EMAIL);
    assert.equal(resolution.userId, OWNER_ID);
    assert.equal(resolution.resolved, true);
    assert.equal(resolution.external, false);
  });

  it('resolves an unknown email as a defined external identity', async () => {
    const resolution = await resolveIdentityByEmail('nobody@example.com');
    assert.equal(resolution.userId, null);
    assert.equal(resolution.external, true);
  });
});
