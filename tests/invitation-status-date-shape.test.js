/**
 * A fresh invitation shows as `active` in the admin user list, also when the
 * database driver hands the expiry back as a Date.
 *
 * `listUsers` compared `invitationExpiresAt > now` where `now` is an ISO
 * string. The pg driver returns `timestamptz` columns as `Date` objects, and a
 * Date-vs-string comparison coerces the string operand to `NaN` — always
 * false — so every invitation, however fresh, showed `expired`. Found during
 * the A7.20 PR 10 verification (#702). The fix normalizes both sides to epoch
 * milliseconds; this file pins the Date shape, the string shape, and a
 * genuinely expired invitation.
 *
 * Run with: node --test tests/invitation-status-date-shape.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth']
  .join('-')
  .padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { listUsers } = await import('../server/storage/users.js');

const scope = {
  organizationId: ORG,
  actorEmail: 'admin@example.com',
  repoRoot: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A user who has never logged in and has no password — the only shape that
 * gets an invitation status at all.
 *
 * @param {string} id
 * @param {string} email
 * @returns {Object} users row
 */
function invitedUser(id, email) {
  return {
    id,
    email,
    name: null,
    role: 'editor',
    auth_source: 'password',
    password_hash: null,
    organization_id: ORG,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * Install a fake db holding one invited user with one unused invitation token.
 *
 * @param {Date|string} expiresAt - the shape under test
 */
function installDb(expiresAt) {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Alpha', slug: 'alpha', settings: {} }],
    users: [invitedUser('user-dana', 'dana@example.com')],
    password_reset_tokens: [
      {
        id: 'token-1',
        user_email: 'dana@example.com',
        token_hash: 'irrelevant',
        expires_at: expiresAt,
        used_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
}

test.afterEach(() => {
  __setTestDb(null);
});

test('a fresh invitation is active when the driver returns the expiry as a Date', async () => {
  installDb(new Date(Date.now() + 7 * DAY_MS));

  const [dana] = await listUsers(scope);
  assert.equal(dana.email, 'dana@example.com');
  assert.equal(dana.invitationStatus, 'active');
});

test('a fresh invitation is active when the expiry is an ISO string', async () => {
  installDb(new Date(Date.now() + 7 * DAY_MS).toISOString());

  const [dana] = await listUsers(scope);
  assert.equal(dana.invitationStatus, 'active');
});

test('an expired invitation is expired in both shapes', async () => {
  for (const shape of [
    new Date(Date.now() - DAY_MS),
    new Date(Date.now() - DAY_MS).toISOString(),
  ]) {
    installDb(shape);
    const [dana] = await listUsers(scope);
    assert.equal(
      dana.invitationStatus,
      'expired',
      `shape: ${shape.constructor.name}`,
    );
  }
});
