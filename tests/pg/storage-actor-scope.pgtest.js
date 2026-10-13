/** B665 actor/organization scopes against PostgreSQL, including bootstrap callers. */
import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  pgDescribe,
  openTestDb,
  closeTestDb,
  truncate,
} from './helpers/harness.js';

process.env.MULTI_ORG_ENABLED = 'true';
const memberships =
  await import('../../server/storage/user-organizations/memberships.js');
const collaborators = await import('../../server/storage/collaborators.js');
const { provisionOrganization } = await import('../../scripts/org-create.js');
const { crossOrganizationScope } =
  await import('../../server/storage/scope.js');
const { resolveActiveMembership } =
  await import('../../server/storage/identity.js');
const { invalidatePermission } =
  await import('../../server/storage/cache/permission-cache.js');

pgDescribe('actor storage scope isolation (real PostgreSQL)', () => {
  let db, orgA, orgB, userId, memberA, memberB, presentationId;
  before(async () => {
    db = await openTestDb();
  });
  after(async () => {
    await closeTestDb(db);
  });
  beforeEach(async () => {
    await truncate(db, 'organizations');
    orgA = randomUUID();
    orgB = randomUUID();
    userId = randomUUID();
    memberA = randomUUID();
    memberB = randomUUID();
    presentationId = randomUUID();
    await db
      .insertInto('organizations')
      .values([
        { id: orgA, name: 'A', slug: 'scope-a' },
        { id: orgB, name: 'B', slug: 'scope-b' },
      ])
      .execute();
    await db
      .insertInto('users')
      .values({
        id: userId,
        organization_id: orgA,
        email: 'scope-owner@example.test',
        name: 'Owner',
        role: 'user',
      })
      .execute();
    await db
      .insertInto('user_organizations')
      .values([
        {
          id: memberA,
          user_id: userId,
          organization_id: orgA,
          role: 'owner',
          joined_at: '2026-01-01',
        },
        {
          id: memberB,
          user_id: userId,
          organization_id: orgB,
          role: 'member',
          joined_at: '2026-02-01',
        },
      ])
      .execute();
    await db
      .insertInto('presentations')
      .values({
        id: presentationId,
        organization_id: orgA,
        title: 'Scoped deck',
        owner_email: 'scope-owner@example.test',
        visibility: 'private',
      })
      .execute();
  });

  it('id-only member mutations cannot reach another organization', async () => {
    const scopeB = { organizationId: orgB };
    assert.equal(
      await memberships.getOrganizationMember(scopeB, orgB, memberA),
      null,
    );
    for (const result of [
      await memberships.updateMemberRole(scopeB, memberA, 'member'),
      await memberships.updateMemberDesigner(scopeB, memberA, true),
      await memberships.removeMember(scopeB, memberA),
    ])
      assert.deepEqual(result, { ok: false, reason: 'not_found' });
    const row = await db
      .selectFrom('user_organizations')
      .selectAll()
      .where('id', '=', memberA)
      .executeTakeFirstOrThrow();
    assert.equal(row.role, 'owner');
    assert.equal(row.is_designer, false);
    assert.equal(await memberships.countOrganizationMembers(scopeB, orgB), 1);
  });

  it('wrong-org reads and writes cannot use a warm collaborator permission', async () => {
    const scopeA = { organizationId: orgA };
    const scopeB = { organizationId: orgB };
    const email = 'external-scope@example.test';
    await invalidatePermission(presentationId, email);
    assert.equal(
      (
        await collaborators.addCollaborator(scopeA, presentationId, {
          userEmail: email,
          permission: 'edit',
        })
      ).ok,
      true,
    );
    assert.equal(
      await collaborators.getCollaboratorPermission(
        scopeA,
        presentationId,
        email,
      ),
      'edit',
    );
    assert.equal(
      await collaborators.getCollaboratorPermission(
        scopeB,
        presentationId,
        email,
      ),
      null,
    );
    assert.deepEqual(
      await collaborators.listCollaborators(scopeB, presentationId),
      [],
    );
    for (const result of [
      await collaborators.addCollaborator(scopeB, presentationId, {
        userEmail: 'another@example.test',
        permission: 'view',
      }),
      await collaborators.updateCollaboratorPermission(
        scopeB,
        presentationId,
        email,
        'admin',
      ),
      await collaborators.removeCollaborator(scopeB, presentationId, email),
    ])
      assert.deepEqual(result, { ok: false, reason: 'not_found' });
    assert.equal(
      await collaborators.getCollaboratorPermission(
        scopeA,
        presentationId,
        email,
      ),
      'edit',
    );
    assert.equal(
      (await collaborators.listCollaborators(scopeA, presentationId)).length,
      1,
    );
  });

  it('global membership selection can recover a revoked requested organization', async () => {
    const scope = crossOrganizationScope(
      null,
      'pre-auth test membership selection',
    );
    assert.equal(
      (await resolveActiveMembership(scope, userId, orgB)).organizationId,
      orgB,
    );
    await memberships.removeMember({ organizationId: orgB }, memberB);
    assert.equal(
      (await resolveActiveMembership(scope, userId, orgB)).organizationId,
      orgA,
    );
  });

  it('operator bootstrap provisions and reuses an organization and its owner', async () => {
    const input = {
      slug: 'scope-bootstrap',
      name: 'Bootstrap',
      ownerEmail: 'bootstrap@example.test',
    };
    const first = await provisionOrganization(input);
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    const second = await provisionOrganization(input);
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(first.organization.id, second.organization.id);
    assert.equal(
      await memberships.countOrganizationMembers(
        { organizationId: first.organization.id },
        first.organization.id,
      ),
      1,
    );
  });
});
