import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  pgDescribe,
  openTestDb,
  closeTestDb,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { getOrCreateMagicLinkUser } from '../../server/storage/magic-link.js';
import {
  setUserPassword,
  verifyUserPassword,
} from '../../server/storage/password-reset.js';
import { ensureUserByEmail } from '../../server/storage/users.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

pgDescribe('email identity provisioning (real PostgreSQL)', () => {
  let db;
  const scope = { organizationId: getDefaultOrganizationId() };
  const options = {
    email: 'identity@example.test',
    role: 'user',
    authSource: 'magic_link',
  };
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

  it('concurrent first logins resolve one identity and one creator', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureUserByEmail(scope, options)),
    );
    assert.equal(new Set(results.map((result) => result.user.id)).size, 1);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(
      (await db.selectFrom('users').selectAll().execute()).length,
      1,
    );
  });

  it('resolves globally without changing the existing home, role or credentials', async () => {
    const first = await ensureUserByEmail(scope, {
      ...options,
      role: 'admin',
      authSource: 'database',
      passwordHash: 'existing-hash',
    });
    const otherOrg = randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: otherOrg, name: 'Other', slug: 'ensure-other' })
      .execute();
    const second = await ensureUserByEmail(
      { organizationId: otherOrg },
      {
        ...options,
        email: ' IDENTITY@EXAMPLE.TEST ',
        name: 'Replacement',
        passwordHash: 'replacement',
      },
    );
    assert.equal(second.created, false);
    assert.equal(second.user.id, first.user.id);
    assert.equal(second.user.organization_id, scope.organizationId);
    assert.equal(second.user.role, 'admin');
    assert.equal(second.user.password_hash, 'existing-hash');
    assert.equal(second.user.auth_source, 'database');
    assert.equal(second.user.name, first.user.name);
  });

  it('refuses unknown identities when provisioning is disabled', async () => {
    assert.deepEqual(
      await ensureUserByEmail(scope, { ...options, autoProvision: false }),
      { user: null, created: false },
    );
    assert.equal(
      (await db.selectFrom('users').selectAll().execute()).length,
      0,
    );
  });

  it('accepts concurrent magic-link first logins for one identity', async () => {
    const results = await Promise.all([
      getOrCreateMagicLinkUser(scope, options.email),
      getOrCreateMagicLinkUser(scope, options.email),
    ]);
    assert.ok(results.every((result) => result.ok));
    assert.equal(results[0].user.id, results[1].user.id);
  });

  it('accepts concurrent password provisioning and preserves an existing admin home', async () => {
    const password = 'B666-test-password-strong!';
    const results = await Promise.all([
      setUserPassword(scope, options.email, password),
      setUserPassword(scope, options.email, password),
    ]);
    assert.ok(results.every((result) => result.ok));
    assert.equal(
      await verifyUserPassword(scope, options.email, password),
      true,
    );
    assert.equal(
      (await db.selectFrom('users').selectAll().execute()).length,
      1,
    );
    await db
      .updateTable('users')
      .set({ role: 'admin' })
      .where('email', '=', options.email)
      .execute();
    const otherOrg = randomUUID();
    await db
      .insertInto('organizations')
      .values({ id: otherOrg, name: 'Other', slug: 'password-other' })
      .execute();
    assert.equal(
      (
        await setUserPassword(
          { organizationId: otherOrg },
          options.email,
          password,
        )
      ).ok,
      true,
    );
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', options.email)
      .executeTakeFirst();
    assert.equal(user.organization_id, scope.organizationId);
    assert.equal(user.role, 'admin');
  });

  it('requires an organization and an explicit role before touching the database', async () => {
    await assert.rejects(ensureUserByEmail({}, options), /organizationId/);
    await assert.rejects(
      ensureUserByEmail(scope, { ...options, role: undefined }),
      /requires email, role/,
    );
  });
});
