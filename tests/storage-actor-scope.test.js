/** Scope refusal and tenant isolation for actor/identity storage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { __setTestDb } from '../server/db/client.js';
import { createFakeDb } from './helpers/fake-db.js';
import * as memberships from '../server/storage/user-organizations/memberships.js';
import * as organizations from '../server/storage/user-organizations/organizations.js';
import * as collaborators from '../server/storage/collaborators.js';
import * as identity from '../server/storage/identity.js';
import * as resolver from '../server/storage/identity-resolver.js';
import * as display from '../server/storage/display-identity.js';
import { verifyIdentityConsistency } from '../server/storage/identity-verification.js';
import { ensureMembership } from '../server/storage/login-membership.js';
import * as passwords from '../server/storage/password-reset.js';
import { invalidatePermission } from '../server/storage/cache/permission-cache.js';

const A = { organizationId: 'org-a', actorEmail: 'owner@a.test' };
const B = { organizationId: 'org-b', actorEmail: 'owner@b.test' };
const cluster = [
  ...[
    'updateMemberDesigner',
    'getMembership',
    'getMembershipByEmail',
    'listUserOrganizations',
    'listOrganizationMembers',
    'getOrganizationMember',
    'countOrganizationMembers',
    'addMember',
    'updateMemberRole',
    'removeMember',
    'transferOwnership',
  ].map((name) => memberships[name]),
  ...[
    'getOrganizationById',
    'getOrganizationBySlug',
    'createOrganization',
    'updateOrganization',
    'deleteOrganization',
  ].map((name) => organizations[name]),
  ...[
    'addCollaborator',
    'removeCollaborator',
    'updateCollaboratorPermission',
    'listCollaborators',
    'getCollaboratorPermission',
  ].map((name) => collaborators[name]),
  identity.getUserByEmailGlobal,
  identity.resolveActiveMembership,
  identity.resolveActiveOrganization,
  resolver.resolveIdentity,
  resolver.resolveIdentityByEmail,
  display.resolveDisplayNames,
  display.resolveNamesForAddresses,
  verifyIdentityConsistency,
  ensureMembership,
  ...[
    'hasDatabaseCredentials',
    'verifyUserPassword',
    'getPasswordChangedAt',
    'logAuthEvent',
    'cleanupOldAuditLogs',
  ].map((name) => passwords[name]),
];

for (const fn of cluster) {
  test(`${fn.name} refuses a missing or old-shaped scope before early returns`, async () => {
    for (const bad of [
      undefined,
      null,
      'old-first-argument',
      {},
      { crossOrganization: ' ' },
    ]) {
      await assert.rejects(async () => fn(bad), {
        name: 'TypeError',
        message: new RegExp(fn.name + '\\(\\)'),
      });
    }
  });
}

test.afterEach(() => {
  __setTestDb(null);
  display.invalidateDisplayNames();
});
function seed() {
  const db = createFakeDb({
    organizations: [
      { id: A.organizationId, name: 'A', slug: 'a' },
      { id: B.organizationId, name: 'B', slug: 'b' },
    ],
    users: [
      {
        id: 'alice',
        email: 'alice@test.example',
        name: 'Alice',
        organization_id: A.organizationId,
      },
    ],
    user_organizations: [
      {
        id: 'member-a',
        user_id: 'alice',
        organization_id: A.organizationId,
        role: 'owner',
      },
      {
        id: 'member-b',
        user_id: 'alice',
        organization_id: B.organizationId,
        role: 'member',
      },
    ],
    presentations: [{ id: 'deck-a', organization_id: A.organizationId }],
    // Legacy stamps do not override the authoritative parent organization.
    presentation_collaborators: [
      {
        id: 'collab',
        presentation_id: 'deck-a',
        organization_id: B.organizationId,
        user_email: 'partner@test.example',
        permission: 'edit',
        revoked_at: null,
      },
    ],
  });
  __setTestDb(db);
  return db;
}

test('membership ids cannot read, edit, demote or remove another organization', async () => {
  const db = seed();
  assert.equal(
    await memberships.getOrganizationMember(B, B.organizationId, 'member-a'),
    null,
  );
  assert.equal(
    await memberships.countOrganizationMembers(B, B.organizationId),
    1,
  );
  assert.deepEqual(
    (await memberships.listUserOrganizations(B, 'alice')).map((row) => row.id),
    ['org-b'],
  );
  const before = structuredClone(db.__tables.user_organizations);
  for (const result of [
    await memberships.updateMemberDesigner(B, 'member-a', true),
    await memberships.updateMemberRole(B, 'member-a', 'member'),
    await memberships.removeMember(B, 'member-a'),
  ]) {
    assert.deepEqual(result, { ok: false, reason: 'not_found' });
  }
  await assert.rejects(
    () => memberships.getMembership(B, 'alice', A.organizationId),
    TypeError,
  );
  await assert.rejects(
    () =>
      memberships.addMember(B, {
        userId: 'new',
        organizationId: A.organizationId,
      }),
    TypeError,
  );
  await assert.rejects(
    () => memberships.transferOwnership(B, A.organizationId, 'alice', 'new'),
    TypeError,
  );
  assert.deepEqual(db.__tables.user_organizations, before);
});

test('organization mutations reject mismatched and cross-organization scopes', async () => {
  const db = seed();
  const before = structuredClone(db.__tables.organizations);
  assert.equal(
    await organizations.getOrganizationById(B, A.organizationId),
    null,
  );
  assert.equal(await organizations.getOrganizationBySlug(B, 'a'), null);
  await assert.rejects(
    () =>
      organizations.updateOrganization(B, A.organizationId, {
        name: 'Changed',
      }),
    TypeError,
  );
  await assert.rejects(
    () => organizations.deleteOrganization(B, A.organizationId),
    TypeError,
  );
  await assert.rejects(
    () =>
      organizations.updateOrganization(
        { crossOrganization: 'operator' },
        A.organizationId,
        { name: 'Changed' },
      ),
    TypeError,
  );
  await assert.rejects(
    () => organizations.createOrganization(A, { name: 'New', slug: 'new' }),
    TypeError,
  );
  assert.deepEqual(db.__tables.organizations, before);
});

test('a warm collaborator cache cannot cross the stored deck organization', async () => {
  const db = seed();
  await invalidatePermission('deck-a', 'partner@test.example');
  assert.equal(
    await collaborators.getCollaboratorPermission(
      A,
      'deck-a',
      'partner@test.example',
    ),
    'edit',
  );
  assert.equal(
    await collaborators.getCollaboratorPermission(
      B,
      'deck-a',
      'partner@test.example',
    ),
    null,
  );
  assert.deepEqual(await collaborators.listCollaborators(B, 'deck-a'), []);
  const before = structuredClone(db.__tables.presentation_collaborators);
  for (const result of [
    await collaborators.addCollaborator(B, 'deck-a', {
      userEmail: 'new@test.example',
      permission: 'edit',
    }),
    await collaborators.removeCollaborator(B, 'deck-a', 'partner@test.example'),
    await collaborators.updateCollaboratorPermission(
      B,
      'deck-a',
      'partner@test.example',
      'admin',
    ),
  ]) {
    assert.deepEqual(result, { ok: false, reason: 'not_found' });
  }
  assert.deepEqual(db.__tables.presentation_collaborators, before);
  assert.equal(
    await collaborators.getCollaboratorPermission(
      A,
      'deck-a',
      'partner@test.example',
    ),
    'edit',
  );
  // Even deletion of the parent cannot leave a cache-granted permission behind.
  db.__tables.presentations.length = 0;
  assert.equal(
    await collaborators.getCollaboratorPermission(
      A,
      'deck-a',
      'partner@test.example',
    ),
    null,
  );
});
