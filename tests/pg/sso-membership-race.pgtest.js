/**
 * Concurrent SSO provisioning against PostgreSQL's actual row locks: the
 * no-claim path (B430) and the organization-claim path (B269, review #1344).
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  openTestDb,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

process.env.MULTI_ORG_ENABLED = 'true';
const { getOrCreateSsoUser } = await import('../../server/storage/sso.js');

const organizationId = getDefaultOrganizationId();
const scope = { organizationId };
const options = { autoProvision: true, defaultRole: 'user' };
const CLAIMED_ORG = '00000000-0000-0000-0000-00000000b269';
const claimed = (email, extra = {}) => ({
  email,
  externalOrgId: 'idp-claimed',
  ...extra,
});

pgDescribe('SSO membership provisioning (real PostgreSQL)', () => {
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
    await seedDefaultOrganization(db);
    await db
      .insertInto('organizations')
      .values({
        id: CLAIMED_ORG,
        name: 'Claimed',
        slug: 'claimed',
        external_id: 'idp-claimed',
      })
      .execute();
  });

  it('gives concurrent first identities exactly one owner', async () => {
    const results = await Promise.all([
      getOrCreateSsoUser(scope, { email: 'first@example.com' }, options),
      getOrCreateSsoUser(scope, { email: 'second@example.com' }, options),
    ]);

    assert.ok(results.every((result) => result.ok));
    assert.deepEqual(results.map((result) => result.membership.role).sort(), [
      'member',
      'owner',
    ]);
    const rows = await db
      .selectFrom('user_organizations')
      .select(['role', 'user_id'])
      .where('organization_id', '=', organizationId)
      .execute();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.role).sort(), ['member', 'owner']);
    assert.notEqual(rows[0].user_id, rows[1].user_id);
  });

  it('accepts concurrent first logins for one identity without duplicate membership', async () => {
    const results = await Promise.all([
      getOrCreateSsoUser(scope, { email: 'same@example.com' }, options),
      getOrCreateSsoUser(scope, { email: 'same@example.com' }, options),
    ]);

    assert.ok(results.every((result) => result.ok));
    assert.equal(results[0].user.id, results[1].user.id);
    assert.equal(results.filter((result) => result.provisioned).length, 1);
    const rows = await db
      .selectFrom('user_organizations')
      .select(['user_id', 'role'])
      .where('user_id', '=', results[0].user.id)
      .execute();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].role, 'owner');
  });

  it('gives concurrent first claimed logins for one identity one membership in the claimed organization', async () => {
    const results = await Promise.all([
      getOrCreateSsoUser(scope, claimed('same@example.com'), options),
      getOrCreateSsoUser(scope, claimed('same@example.com'), options),
    ]);

    assert.ok(results.every((result) => result.ok));
    assert.equal(results[0].user.id, results[1].user.id);
    assert.ok(results.every((result) => result.organizationId === CLAIMED_ORG));
    const rows = await db
      .selectFrom('user_organizations')
      .select(['organization_id', 'role'])
      .where('user_id', '=', results[0].user.id)
      .execute();
    assert.deepEqual(rows, [{ organization_id: CLAIMED_ORG, role: 'member' }]);
  });

  it('adds one claimed membership when a member elsewhere logs in twice at once', async () => {
    const [user] = await db
      .insertInto('users')
      .values({
        organization_id: organizationId,
        email: 'elsewhere@example.com',
        role: 'user',
      })
      .returning('id')
      .execute();
    await db
      .insertInto('user_organizations')
      .values({
        user_id: user.id,
        organization_id: organizationId,
        role: 'owner',
      })
      .execute();

    const results = await Promise.all([
      getOrCreateSsoUser(scope, claimed('elsewhere@example.com'), options),
      getOrCreateSsoUser(scope, claimed('elsewhere@example.com'), options),
    ]);

    assert.ok(results.every((result) => result.ok));
    assert.equal(results.filter((result) => result.membership).length, 1);
    const rows = await db
      .selectFrom('user_organizations')
      .select(['organization_id', 'role'])
      .where('user_id', '=', user.id)
      .orderBy('organization_id')
      .execute();
    assert.deepEqual(rows, [
      { organization_id: organizationId, role: 'owner' },
      { organization_id: CLAIMED_ORG, role: 'member' },
    ]);
  });

  it('refuses a claim it may not provision without writing the user row', async () => {
    const [user] = await db
      .insertInto('users')
      .values({
        organization_id: organizationId,
        email: 'kept@example.com',
        name: 'Kept',
        role: 'user',
        auth_source: 'database',
      })
      .returningAll()
      .execute();
    await db
      .insertInto('user_organizations')
      .values({
        user_id: user.id,
        organization_id: organizationId,
        role: 'member',
      })
      .execute();

    const result = await getOrCreateSsoUser(
      scope,
      claimed('kept@example.com', { name: 'Renamed', isAdmin: true }),
      { autoProvision: false, defaultRole: 'user' },
    );

    assert.deepEqual(result, { ok: false, reason: 'no_membership' });
    const after = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    assert.deepEqual(after, user);
    const memberships = await db
      .selectFrom('user_organizations')
      .select('organization_id')
      .where('user_id', '=', user.id)
      .execute();
    assert.deepEqual(memberships, [{ organization_id: organizationId }]);
  });
});
