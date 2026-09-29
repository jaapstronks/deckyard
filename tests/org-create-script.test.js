/**
 * Provisioning an organization without the UI (B425): `npm run org:create`.
 *
 * The script's work is `provisionOrganization()`; these tests drive it against
 * the in-memory double. What they pin: it creates through the one storage
 * implementation (`createOrganization`), it is idempotent on the slug, it
 * refuses a rerun that disagrees with what is stored instead of editing it, and
 * `--owner` writes the membership a first login writes into an empty
 * organization — owner — creating the account when there is none.
 *
 * Run with: node --test tests/org-create-script.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MULTI_ORG_ENABLED = 'true';

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { provisionOrganization } = await import('../scripts/org-create.js');

/** A default organization with one person in it, and nothing else. */
function seed() {
  const db = createFakeDb({
    organizations: [
      {
        id: DEFAULT_ORG,
        name: 'Default',
        slug: 'default',
        external_id: null,
        display_name: null,
        description: null,
        settings: {},
      },
    ],
    users: [
      {
        id: 'user-existing',
        organization_id: DEFAULT_ORG,
        email: 'kim@example.com',
        name: 'Kim',
        role: 'user',
        auth_source: 'database',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
    ],
    user_organizations: [
      {
        id: 'membership-existing',
        user_id: 'user-existing',
        organization_id: DEFAULT_ORG,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    password_reset_tokens: [],
  });
  __setTestDb(db);
  return db;
}

/** @param {Object} db @param {string} slug */
const orgBySlug = (db, slug) =>
  db.__tables.organizations.find((o) => o.slug === slug);

/** @param {Object} db @param {string} organizationId */
const membersOf = (db, organizationId) =>
  db.__tables.user_organizations.filter(
    (m) => m.organization_id === organizationId,
  );

test('creates an organization without members, external ID stored', async () => {
  const db = seed();
  const result = await provisionOrganization({
    slug: 'Acme',
    name: 'Acme',
    externalId: 'idp-acme',
  });
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.owner, null);
  const row = orgBySlug(db, 'acme');
  assert.equal(row.name, 'Acme');
  assert.equal(row.external_id, 'idp-acme');
  assert.equal(membersOf(db, row.id).length, 0);
});

test('a rerun with the same arguments changes nothing', async () => {
  const db = seed();
  const first = await provisionOrganization({
    slug: 'acme',
    name: 'Acme',
    ownerEmail: 'kim@example.com',
  });
  const second = await provisionOrganization({
    slug: 'acme',
    name: 'Acme',
    ownerEmail: 'kim@example.com',
  });
  assert.equal(second.ok, true);
  assert.equal(second.created, false);
  assert.equal(second.organization.id, first.organization.id);
  assert.equal(second.owner.membershipAdded, false);
  assert.equal(db.__tables.organizations.length, 2);
  assert.equal(membersOf(db, first.organization.id).length, 1);
});

test('a rerun that disagrees is refused, not applied', async () => {
  const db = seed();
  await provisionOrganization({
    slug: 'acme',
    name: 'Acme',
    externalId: 'idp-acme',
  });
  const renamed = await provisionOrganization({
    slug: 'acme',
    name: 'Acme BV',
  });
  assert.equal(renamed.ok, false);
  const rebound = await provisionOrganization({
    slug: 'acme',
    name: 'Acme',
    externalId: 'idp-other',
  });
  assert.equal(rebound.ok, false);
  const row = orgBySlug(db, 'acme');
  assert.equal(row.name, 'Acme');
  assert.equal(row.external_id, 'idp-acme');
});

test('an external ID another organization holds is refused', async () => {
  const db = seed();
  await provisionOrganization({ slug: 'acme', name: 'Acme', externalId: 'x' });
  const result = await provisionOrganization({
    slug: 'beta',
    name: 'Beta',
    externalId: 'x',
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /already routes logins/);
  assert.equal(orgBySlug(db, 'beta'), undefined);
});

test('--owner makes an existing person owner, keeping their other memberships', async () => {
  const db = seed();
  const result = await provisionOrganization({
    slug: 'acme',
    name: 'Acme',
    ownerEmail: 'KIM@example.com',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.owner, {
    email: 'kim@example.com',
    accountCreated: false,
    membershipAdded: true,
  });
  const [membership] = membersOf(db, result.organization.id);
  assert.equal(membership.user_id, 'user-existing');
  assert.equal(membership.role, 'owner');
  assert.equal(membersOf(db, DEFAULT_ORG).length, 1);
  assert.equal(db.__tables.users.length, 1);
});

test('--owner creates the account, homed in the new organization', async () => {
  const db = seed();
  const result = await provisionOrganization({
    slug: 'acme',
    name: 'Acme',
    ownerEmail: 'new@acme.example',
  });
  assert.equal(result.ok, true);
  assert.equal(result.owner.accountCreated, true);
  const user = db.__tables.users.find((u) => u.email === 'new@acme.example');
  assert.equal(user.organization_id, result.organization.id);
  assert.equal(user.role, 'user');
  const [membership] = membersOf(db, result.organization.id);
  assert.equal(membership.user_id, user.id);
  assert.equal(membership.role, 'owner');
});

test('--owner on an organization that already has members is refused', async () => {
  const db = seed();
  await provisionOrganization({
    slug: 'acme',
    name: 'Acme',
    ownerEmail: 'kim@example.com',
  });
  const result = await provisionOrganization({
    slug: 'acme',
    name: 'Acme',
    ownerEmail: 'second@acme.example',
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /already has members/);
  assert.equal(membersOf(db, orgBySlug(db, 'acme').id).length, 1);
});

test('refuses on a single-organization instance, and on a malformed slug', async () => {
  const db = seed();
  assert.equal(
    (await provisionOrganization({ slug: 'a_b', name: 'Acme' })).ok,
    false,
  );
  process.env.MULTI_ORG_ENABLED = 'false';
  try {
    const result = await provisionOrganization({ slug: 'acme', name: 'Acme' });
    assert.equal(result.ok, false);
    assert.match(result.message, /MULTI_ORG_ENABLED is off/);
  } finally {
    process.env.MULTI_ORG_ENABLED = 'true';
  }
  assert.equal(db.__tables.organizations.length, 1);
});
