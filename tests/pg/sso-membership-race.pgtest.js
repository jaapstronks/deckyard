/** Concurrent SSO provisioning against PostgreSQL's actual row locks. */

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
});
