/**
 * Organizations are session-bound, never host-bound (A1 phase 3).
 *
 * Phase 3 removed a second, never-finished route to "which organization is this
 * request": subdomain extraction from the Host header, two lookups that found
 * an organization by subdomain or custom domain, a separate context builder,
 * and the `subdomain` / `custom_domain` / `billing_email` columns the API kept
 * writing but nothing ever read.
 *
 * The reason is a modelling one, which is why it is worth a test rather than
 * only a changelog line: a hostname identifies an *instance*, while an
 * organization is a dimension *within* an instance. An instance served at its
 * own hostname is deploy configuration; treating that hostname as a claim about
 * which organization owns a deck conflates two things that are free to differ.
 *
 * **Which assertions fail without the change** (restore the write paths in
 * server/storage/user-organizations/organizations.js and the select list in
 * memberships.js):
 *
 *   - 'creating an organization stores no host-routing or billing column' — the
 *     old create path passed `subdomain` and `billing_email` straight through.
 *   - 'updating an organization ignores host-routing and billing fields' — the
 *     old update path took `subdomain` (with its own uniqueness check) and
 *     `billingEmail`.
 *   - 'the workspace list carries no subdomain' — the old join selected
 *     `organizations.subdomain` and the mapper exposed it.
 *
 * The Host-header cases are a *forward* guard, not a regression proof: the host
 * route was never wired, so they pass on both sides of the change. They exist so
 * that wiring one up later fails here first, with this comment attached.
 *
 * MULTI_WORKSPACE_ENABLED is read at module scope (server/config/features.js),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/organization-host-independence.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
process.env.MULTI_WORKSPACE_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG_A = process.env.DEFAULT_ORGANIZATION_ID;
const ORG_B = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const auth = await import('../server/auth/auth.js');
const context = await import('../server/utils/context.js');
const { createRouteContext } = context;
const { createOrganization, updateOrganization, listUserOrganizations } = await import(
  '../server/storage/user-organizations.js'
);

let passwordHash;

test.before(async () => {
  passwordHash = await hashPassword('correct horse battery');
});

test.afterEach(() => {
  __setTestDb(null);
});

/**
 * Alice is a member of Alpha (older) and Beta (newer); Beta is her home org.
 * @returns {Object} the fake db
 */
function seedTwoOrgs() {
  const db = createFakeDb({
    organizations: [
      { id: ORG_A, name: 'Alpha', slug: 'alpha' },
      { id: ORG_B, name: 'Beta', slug: 'beta' },
    ],
    users: [
      {
        id: 'user-alice',
        organization_id: ORG_B,
        email: 'alice@example.com',
        name: 'Alice',
        role: 'user',
        auth_source: 'database',
        password_hash: passwordHash,
        password_changed_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        settings: {},
      },
    ],
    user_organizations: [
      {
        id: 'membership-a',
        user_id: 'user-alice',
        organization_id: ORG_A,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'membership-b',
        user_id: 'user-alice',
        organization_id: ORG_B,
        role: 'owner',
        is_designer: false,
        joined_at: '2026-03-01T00:00:00.000Z',
      },
    ],
  });
  __setTestDb(db);
  return db;
}

/**
 * Build a request whose cookie carries a session for `organizationId`, with
 * `headers` merged in so a test can add a misleading Host.
 * @param {Object} user - The logged-in user
 * @param {string} organizationId - Organization the session is in
 * @param {Object} [headers] - Extra request headers
 * @returns {Object} a request-shaped object
 */
function requestWithSession(user, organizationId, headers = {}) {
  const req = { headers: {} };
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
  };
  auth.setSessionCookie(req, res, user, { organizationId });
  return {
    headers: {
      cookie: String(res.headers['Set-Cookie']).split(';')[0],
      ...headers,
    },
  };
}

/**
 * Resolve a request in `organizationId` down to a route context.
 * @param {string} organizationId - Organization the session is in
 * @param {Object} [headers] - Extra request headers
 * @returns {Promise<Object>} the route context
 */
async function contextFor(organizationId, headers = {}) {
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', {
    organizationId: ORG_A,
    actorEmail: 'alice@example.com',
  });
  const authedUser = await auth.getUserFromRequestAsync(
    requestWithSession(login, organizationId, headers),
    {}
  );
  return createRouteContext(authedUser);
}

// ---------------------------------------------------------------------------
// The hostname says nothing about the organization
// ---------------------------------------------------------------------------

test('a Host header naming another organization does not move the request', async () => {
  seedTwoOrgs();

  const ctx = await contextFor(ORG_B, {
    host: 'alpha.deckyard.test',
    'x-forwarded-host': 'alpha.deckyard.test',
  });

  assert.equal(
    ctx.organizationId,
    ORG_B,
    'the session organization wins over a hostname that names another one'
  );
});

test('an organization-shaped hostname does not stand in for a session', async () => {
  seedTwoOrgs();

  // No cookie at all: the hostname is the only organization-ish signal present,
  // and it must produce no authenticated user and therefore no binding.
  const authedUser = await auth.getUserFromRequestAsync(
    { headers: { host: 'beta.deckyard.test' } },
    {}
  );

  assert.equal(authedUser, null, 'a hostname alone authenticates nobody');
});

test('the context module exposes no way to derive an organization from a request', () => {
  // Deliberately an absence assertion: the point of phase 3 is that this second
  // path does not exist. Re-adding one of these names should fail here first, so
  // whoever does it reads why the hostname was rejected as a signal.
  for (const gone of [
    'extractSubdomain',
    'isReservedSubdomain',
    'getOrgContextFromRequest',
    'createMultiWorkspaceContext',
  ]) {
    assert.equal(gone in context, false, `${gone} is not part of the context surface`);
  }
});

// ---------------------------------------------------------------------------
// The columns cannot come back through a write path
// ---------------------------------------------------------------------------

test('creating an organization stores no host-routing or billing column', async () => {
  const db = seedTwoOrgs();

  const result = await createOrganization({
    name: 'Gamma',
    slug: 'gamma',
    displayName: 'Gamma Inc',
    description: 'Third workspace',
    ownerId: 'user-alice',
    // A caller that still believes these are supported:
    subdomain: 'gamma',
    customDomain: 'slides.gamma.test',
    billingEmail: 'billing@gamma.test',
  });

  assert.equal(result.ok, true);

  const stored = db.__tables.organizations.find((row) => row.slug === 'gamma');
  assert.ok(stored, 'the organization was inserted');
  for (const column of ['subdomain', 'custom_domain', 'billing_email']) {
    assert.equal(column in stored, false, `${column} was not written`);
  }

  // The public shape follows the columns, so nothing downstream can read them.
  for (const key of ['subdomain', 'customDomain', 'billingEmail']) {
    assert.equal(key in result.organization, false, `${key} is not in the returned organization`);
  }
  assert.equal(result.organization.displayName, 'Gamma Inc', 'real metadata still round-trips');
});

test('updating an organization ignores host-routing and billing fields', async () => {
  const db = seedTwoOrgs();

  const result = await updateOrganization(ORG_A, {
    displayName: 'Alpha Inc',
    subdomain: 'alpha',
    billingEmail: 'billing@alpha.test',
  });

  assert.equal(result.ok, true);

  const stored = db.__tables.organizations.find((row) => row.id === ORG_A);
  assert.equal(stored.display_name, 'Alpha Inc', 'the supported field was written');
  for (const column of ['subdomain', 'custom_domain', 'billing_email']) {
    assert.equal(column in stored, false, `${column} stayed off the row`);
  }
});

test('the workspace list carries no subdomain', async () => {
  seedTwoOrgs();

  const organizations = await listUserOrganizations('user-alice');

  assert.equal(organizations.length, 2, 'both memberships are listed');
  for (const org of organizations) {
    assert.equal('subdomain' in org, false, `${org.slug} is listed without a subdomain`);
    assert.ok(org.slug, 'slug remains the human-readable identifier');
  }
});
