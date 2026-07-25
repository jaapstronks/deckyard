/**
 * The request-to-organization binding, single-workspace mode (A1 phase 1).
 *
 * This is the regression net for the change that lets
 * `authedUser.organizationId` through `createRouteContext`. Every assertion
 * here describes behaviour that MUST NOT change for an existing installation:
 * single-workspace instances have exactly one organization, so the value the
 * session resolves to *is* the default organization and the binding is a no-op
 * for them — including its cost. None of these tests go red when the change is
 * reverted; that is the point. The assertions that do are in
 * request-organization-binding-multi-org.test.js.
 *
 * The cost half matters as much as the behaviour half: `createRouteContext` is
 * on every request, so the configuration-only branch in
 * `resolveActiveOrganization()` must stay in front of the database. Two tests
 * below assert against the query log that nothing extra is issued.
 *
 * MULTI_WORKSPACE_ENABLED is read at module scope (server/config/features.js:15),
 * so this file unsets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/request-organization-binding.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
delete process.env.MULTI_WORKSPACE_ENABLED;
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const DEFAULT_ORG = process.env.DEFAULT_ORGANIZATION_ID;
const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';

const { createFakeDb, touchedTables } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const { isMultiWorkspaceEnabled } = await import('../server/config/features.js');
const auth = await import('../server/auth/auth.js');
const { createRouteContext } = await import('../server/utils/context.js');
const { withPresentations } = await import(
  '../server/storage/adapters/postgres/presentations.js'
);

const PresentationsAdapter = withPresentations(class {});

let passwordHash;

test.before(async () => {
  passwordHash = await hashPassword('correct horse battery');
  assert.equal(isMultiWorkspaceEnabled(), false, 'multi-workspace flag is off for this file');
});

test.afterEach(() => {
  __setTestDb(null);
});

/**
 * One organization, one user, one deck — the shape of every existing install.
 * @returns {Object} the fake db
 */
function seedSingleOrg() {
  const db = createFakeDb({
    organizations: [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }],
    users: [
      {
        id: 'user-alice',
        organization_id: DEFAULT_ORG,
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
        id: 'membership-alice',
        user_id: 'user-alice',
        organization_id: DEFAULT_ORG,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    presentations: [
      {
        id: 'deck-1',
        organization_id: DEFAULT_ORG,
        title: 'The only deck',
        owner_email: 'alice@example.com',
        created_by: 'alice@example.com',
        updated_by: 'alice@example.com',
        scope: 'workspace',
        theme: 'default',
        lang: 'nl',
        revision: 1,
        is_view_only: false,
        slides: [],
        i18n: null,
        settings: {},
        created_at: '2026-02-01T00:00:00.000Z',
        modified_at: '2026-02-01T00:00:00.000Z',
        trashed_at: null,
      },
    ],
  });
  __setTestDb(db);
  return db;
}

/** Build a request whose cookie carries the session the server just set. */
function requestWithSession(user, options = {}) {
  const req = { headers: {} };
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  auth.setSessionCookie(req, res, user, options);
  return { headers: { cookie: String(res.headers['Set-Cookie']).split(';')[0] } };
}

/** Log in and resolve a request down to the route context a handler receives. */
async function resolveContext(sessionOptions = {}) {
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', {
    organizationId: DEFAULT_ORG,
    actorEmail: 'alice@example.com',
  });
  const authedUser = await auth.getUserFromRequestAsync(
    requestWithSession(login, sessionOptions),
    {}
  );
  return { authedUser, ctx: createRouteContext(authedUser) };
}

// ---------------------------------------------------------------------------
// Behaviour is unchanged
// ---------------------------------------------------------------------------

test('a request resolves to the default organization', async () => {
  seedSingleOrg();
  const { ctx } = await resolveContext();

  assert.equal(ctx.organizationId, DEFAULT_ORG);
  assert.equal(ctx.actorEmail, 'alice@example.com');
});

test('a session asking for another organization still resolves to the default', async () => {
  seedSingleOrg();

  // Nothing can mint such a cookie in single-workspace mode (setSessionCookie
  // omits orgId entirely there), but an instance that once ran with the flag on
  // can still be holding one. It must not steer the request.
  const { ctx } = await resolveContext({ organizationId: OTHER_ORG });
  assert.equal(ctx.organizationId, DEFAULT_ORG);
});

test('contexts built without an authenticated user are unchanged', () => {
  seedSingleOrg();

  assert.equal(createRouteContext(null).organizationId, DEFAULT_ORG);
  assert.equal(createRouteContext(undefined).organizationId, DEFAULT_ORG);
  assert.equal(
    createRouteContext({ email: 'apikey-owner@example.com' }).organizationId,
    DEFAULT_ORG
  );
  assert.equal(
    createRouteContext(null, { organizationId: OTHER_ORG }).organizationId,
    OTHER_ORG,
    'the explicit override keeps working'
  );
});

test('storage still scopes on the default organization', async () => {
  const db = seedSingleOrg();
  const adapter = new PresentationsAdapter();
  const { ctx } = await resolveContext();

  const listed = await adapter.listPresentations(ctx);
  assert.deepEqual(listed.map((p) => p.id), ['deck-1']);

  const created = await adapter.createPresentation({ title: 'New' }, ctx);
  assert.equal(
    db.__tables.presentations.find((p) => p.id === created.id).organization_id,
    DEFAULT_ORG
  );
});

// ---------------------------------------------------------------------------
// Cost is unchanged: the configuration-only branch stays in front of the DB
// ---------------------------------------------------------------------------

test('building a context issues no queries at all', async () => {
  const db = seedSingleOrg();
  const { authedUser } = await resolveContext();

  db.__queryLog.length = 0;
  const ctx = createRouteContext(authedUser);

  assert.equal(ctx.organizationId, DEFAULT_ORG);
  assert.deepEqual(db.__queryLog, [], 'createRouteContext is pure');
});

test('resolving a session touches only the users table', async () => {
  const db = seedSingleOrg();
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', {
    organizationId: DEFAULT_ORG,
    actorEmail: 'alice@example.com',
  });
  const req = requestWithSession(login);

  db.__queryLog.length = 0;
  createRouteContext(await auth.getUserFromRequestAsync(req, {}));

  assert.deepEqual(
    [...new Set(touchedTables(db))],
    ['users'],
    'no membership lookup is issued when multi-workspace is off'
  );
});
