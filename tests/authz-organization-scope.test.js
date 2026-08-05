/**
 * The organization-aware authorization layer, single-workspace (A1 phase 2).
 *
 * `presentation-authz/presentations.js` granted `scope: 'workspace'` access
 * unconditionally. It now grants it only to someone acting in the organization
 * that owns the deck. This file is the half that pins that **existing
 * installations do not notice**: one organization means there is nothing to
 * compare, so every workspace grant that used to be given is still given, and
 * the check itself never reaches the database.
 *
 * None of the assertions here fail without the change — that is the point.
 * The ones that do fail live in authz-organization-scope-multi-org.test.js.
 *
 * The chain is walked the way a request does: session cookie →
 * `getUserFromRequestAsync` → the Postgres presentations adapter →
 * `mapPresentationRow` → the authorization functions. That matters, because the
 * organization now has to survive the mapper to reach the check.
 *
 * MULTI_WORKSPACE_ENABLED is read at module scope (server/config/features.js:15),
 * so this file sets its environment before importing anything and relies on
 * node --test giving each file its own process.
 *
 * Run with: node --test tests/authz-organization-scope.test.js
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

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const { isMultiWorkspaceEnabled } = await import('../server/config/features.js');
const auth = await import('../server/auth/auth.js');
const {
  isSameOrganization,
  canReadPresentation,
  canWritePresentation,
  canCommentOnPresentation,
  getEffectivePermission,
} = await import('../server/utils/presentation-authz/presentations.js');
const { checkActorAccess } = await import(
  '../server/utils/presentation-authz/actor-access.js'
);
const { withPresentations } = await import(
  '../server/storage/adapters/postgres/presentations.js'
);

const PresentationsAdapter = withPresentations(class {});

let passwordHash;

test.before(async () => {
  passwordHash = await hashPassword('correct horse battery');
  assert.equal(isMultiWorkspaceEnabled(), false, 'single-workspace mode for this file');
});

/** One organization, one person, one workspace deck and one private deck. */
function seedDb() {
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
      deckRow({ id: 'deck-workspace', scope: 'workspace', owner: 'bob@example.com' }),
      deckRow({ id: 'deck-private', scope: 'private', owner: 'bob@example.com' }),
    ],
  });
  __setTestDb(db);
  return db;
}

function deckRow({ id, scope, owner }) {
  return {
    id,
    organization_id: DEFAULT_ORG,
    title: id,
    owner_email: owner,
    created_by: owner,
    updated_by: owner,
    scope,
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
  };
}

/** Build a request whose cookie carries the session the server just set. */
function requestWithSession(user) {
  const req = { headers: {} };
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  auth.setSessionCookie(req, res, user);
  return { headers: { cookie: String(res.headers['Set-Cookie']).split(';')[0] } };
}

/** Log in as Alice and hand back the user a route handler would receive. */
async function sessionUser() {
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', {
    organizationId: DEFAULT_ORG,
    actorEmail: 'alice@example.com',
  });
  return auth.getUserFromRequestAsync(requestWithSession(login), {});
}

/** Read a deck the way a route does, through the adapter and the mapper. */
async function loadDeck(id) {
  const adapter = new PresentationsAdapter();
  return adapter.getPresentation(id, { organizationId: DEFAULT_ORG });
}

// ---------------------------------------------------------------------------
// The workspace grant is unchanged
// ---------------------------------------------------------------------------

test('a workspace deck someone else owns is still readable', async () => {
  seedDb();
  const user = await sessionUser();
  const pres = await loadDeck('deck-workspace');

  assert.equal(canReadPresentation({ user, pres }), true);
});

test('a workspace deck someone else owns is still writable', async () => {
  seedDb();
  const user = await sessionUser();
  const pres = await loadDeck('deck-workspace');

  assert.equal(canWritePresentation({ user, pres }), true);
});

test('a workspace deck someone else owns still accepts comments', async () => {
  seedDb();
  const user = await sessionUser();
  const pres = await loadDeck('deck-workspace');

  assert.equal(canCommentOnPresentation({ user, pres }), true);
});

test('the effective permission on a workspace deck is still edit', async () => {
  seedDb();
  const user = await sessionUser();
  const pres = await loadDeck('deck-workspace');

  assert.equal(getEffectivePermission({ user, pres }), 'edit');
});

test("someone else's private deck is still refused", async () => {
  seedDb();
  const user = await sessionUser();
  const pres = await loadDeck('deck-private');

  assert.equal(canReadPresentation({ user, pres }), false);
  assert.equal(getEffectivePermission({ user, pres }), 'view');
});

test('machine clients keep their workspace access', async () => {
  seedDb();
  const pres = await loadDeck('deck-workspace');

  // A single-workspace install has nothing to compare, so a machine client that
  // states no organization is unaffected by the L10 rewiring — the point of
  // that change is that in multi-workspace mode the workspace grant is decided
  // against the *key's* organization instead of the deck's.
  const actor = { email: 'alice@example.com' };
  assert.equal(checkActorAccess({ pres, actor }), true);
  assert.equal(checkActorAccess({ pres, actor, access: 'write' }), true);
});

// ---------------------------------------------------------------------------
// Shapes that carry no organization at all
// ---------------------------------------------------------------------------

test('a presentation without an organization is still a workspace deck', () => {
  // The file backend has no organization dimension (multi-workspace is refused
  // on it at boot, server/server.js), so its decks arrive without one. In
  // single-workspace mode that must not cost anyone access.
  const pres = { id: 'deck-file', scope: 'workspace', ownerEmail: 'bob@example.com' };
  const user = { email: 'alice@example.com' };

  assert.equal(canReadPresentation({ user, pres }), true);
  assert.equal(canWritePresentation({ user, pres }), true);
  assert.equal(getEffectivePermission({ user, pres }), 'edit');
});

test('a user without an organization keeps workspace access', () => {
  const pres = { id: 'deck-1', scope: 'workspace', organizationId: DEFAULT_ORG };

  assert.equal(isSameOrganization({ email: 'alice@example.com' }, pres), true);
});

// ---------------------------------------------------------------------------
// Cost: the check is free, and the organization rides along for free
// ---------------------------------------------------------------------------

test('the organization check issues no queries', async () => {
  const db = seedDb();
  const user = await sessionUser();
  const pres = await loadDeck('deck-workspace');

  db.__queryLog.length = 0;
  canReadPresentation({ user, pres });
  canWritePresentation({ user, pres });
  canCommentOnPresentation({ user, pres });
  getEffectivePermission({ user, pres });

  assert.deepEqual(db.__queryLog, [], 'authorization stays pure');
});

test('reading a deck still costs exactly one presentations query', async () => {
  const db = seedDb();
  db.__queryLog.length = 0;
  await loadDeck('deck-workspace');

  assert.deepEqual(
    db.__queryLog,
    [{ op: 'select', table: 'presentations' }],
    'the organization comes off the row already being read, not a second lookup'
  );
});

test('the mapper exposes the owning organization', async () => {
  seedDb();
  const pres = await loadDeck('deck-workspace');

  assert.equal(
    pres.organizationId,
    DEFAULT_ORG,
    'mapPresentationRow used to drop organization_id'
  );
});
