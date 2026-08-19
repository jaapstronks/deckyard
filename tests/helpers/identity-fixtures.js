/**
 * Seeded identities for tests that run over `tests/helpers/fake-db.js`.
 *
 * Ownership is decided on `users.id` and on nothing else (D22; see
 * shared/identity-match.js), so a deck stamped with an address and no id
 * belongs to nobody. Tests that used to get away with a bare `{ email }` actor
 * and a `createPresentation({ ownerEmail })` now have to seed the person too:
 * the create path resolves the id *from* the address in the same statement
 * (`resolveIdentityByEmail`), so one seeded `users` row is enough to make the
 * whole flow behave like production.
 *
 * @module tests/helpers/identity-fixtures
 */

/**
 * The stable id a seeded address gets. Derived from the address so a test can
 * name either half without threading a constant through its fixtures.
 *
 * @param {string} email
 * @returns {string}
 */
export function userIdFor(email) {
  return `user-${String(email).split('@')[0]}`;
}

/**
 * A `users` row in the shape the storage layer reads.
 *
 * @param {string} email
 * @param {Object} [overrides] - Row fields the test cares about (name, role, …)
 * @returns {Object}
 */
export function userRow(email, overrides = {}) {
  return {
    id: userIdFor(email),
    organization_id: process.env.DEFAULT_ORGANIZATION_ID,
    email,
    name: email.split('@')[0],
    role: 'user',
    auth_source: 'database',
    password_hash: null,
    settings: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * The `users` rows for a set of addresses, for a `createFakeDb({ users })` seed.
 *
 * @param {...string} emails
 * @returns {Object[]}
 */
export function userRows(...emails) {
  return emails.flat().map((email) => userRow(email));
}

/**
 * A session for a seeded address: the id every ownership check compares, with
 * the address beside it for display and logging.
 *
 * @param {string} email
 * @param {Object} [overrides] - e.g. `{ isAdmin: true }`
 * @returns {Object}
 */
export function sessionFor(email, overrides = {}) {
  return { id: userIdFor(email), email, ...overrides };
}
