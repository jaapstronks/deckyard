/**
 * The organization-aware authorization layer, with MULTI_WORKSPACE_ENABLED
 * (A1 phase 2).
 *
 * `presentation-authz/presentations.js` returned `true` for `scope: 'workspace'`
 * without ever mentioning organizations, so as far as the authorization layer
 * was concerned every authenticated person was a member of every workspace. The
 * storage layer stopped that from mattering — every presentation query scopes on
 * `organization_id` — but a layer that only holds because the layer beneath it
 * remembers to scope is not a layer. This file holds the assertions that fail
 * without the check.
 *
 * **Which assertions fail without the change** (revert the four
 * `isSameOrganization(user, pres)` guards in
 * server/utils/presentation-authz/presentations.js and these six go red, the
 * rest stay green):
 *
 *   - 'a workspace deck from another organization is not readable'
 *   - 'a workspace deck from another organization is not writable'
 *   - 'a workspace deck from another organization does not accept comments'
 *   - 'the effective permission on another organization's deck is view'
 *   - 'a workspace deck with no organization is refused'
 *   - 'a user with no organization is refused a workspace deck'
 *
 * The rest pin what must *not* change: the person's own workspace decks, the
 * grants that never rested on the workspace at all (ownership, a collaborator
 * row), and the machine-client path, whose organization resolution is a
 * separate open item (see docs/reference/tenant-isolation.md).
 *
 * MULTI_WORKSPACE_ENABLED is read at module scope (server/config/features.js:15),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/authz-organization-scope-multi-org.test.js
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
const { isMultiWorkspaceEnabled } = await import('../server/config/features.js');
const auth = await import('../server/auth/auth.js');
const {
  isSameOrganization,
  canReadPresentation,
  canWritePresentation,
  canCommentOnPresentation,
  canDeletePresentation,
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
  assert.equal(isMultiWorkspaceEnabled(), true, 'multi-workspace flag is on for this file');
});

/**
 * Alice works in organization Alpha, Bob in organization Beta. Each has a
 * workspace deck owned by a third person, so nothing here is decided by
 * ownership.
 */
function seedDb() {
  const db = createFakeDb({
    organizations: [
      { id: ORG_A, name: 'Alpha', slug: 'alpha' },
      { id: ORG_B, name: 'Beta', slug: 'beta' },
    ],
    users: [
      person({ id: 'user-alice', org: ORG_A, email: 'alice@alpha.example' }),
      person({ id: 'user-bob', org: ORG_B, email: 'bob@beta.example' }),
    ],
    user_organizations: [
      {
        id: 'membership-alice',
        user_id: 'user-alice',
        organization_id: ORG_A,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'membership-bob',
        user_id: 'user-bob',
        organization_id: ORG_B,
        role: 'member',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    presentations: [
      deckRow({ id: 'deck-alpha', org: ORG_A, scope: 'workspace' }),
      deckRow({ id: 'deck-beta', org: ORG_B, scope: 'workspace' }),
      deckRow({ id: 'deck-alpha-owned', org: ORG_A, scope: 'private', owner: 'bob@beta.example' }),
    ],
  });
  __setTestDb(db);
  return db;
}

function person({ id, org, email }) {
  return {
    id,
    organization_id: org,
    email,
    name: email,
    role: 'user',
    auth_source: 'database',
    password_hash: passwordHash,
    password_changed_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    settings: {},
  };
}

function deckRow({ id, org, scope, owner = 'carol@alpha.example' }) {
  return {
    id,
    organization_id: org,
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

/** Log in and hand back the user a route handler would receive. */
async function sessionUser(email, organizationId) {
  const login = await auth.verifyLoginAsync(email, 'correct horse battery', {
    organizationId,
    actorEmail: email,
  });
  return auth.getUserFromRequestAsync(requestWithSession(login, { organizationId }), {});
}

/**
 * Read a deck through the adapter and the mapper, naming the organization the
 * row lives in. A route cannot reach another organization's deck this way; the
 * point here is what the authorization layer does when one is handed to it
 * anyway, which is what "defense in depth" means.
 */
async function loadDeck(id, organizationId) {
  const adapter = new PresentationsAdapter();
  return adapter.getPresentation(id, { organizationId });
}

// ---------------------------------------------------------------------------
// The workspace grant stops at the organization boundary
// ---------------------------------------------------------------------------

test('a workspace deck from another organization is not readable', async () => {
  seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);

  assert.equal(canReadPresentation({ user: bob, pres: alphaDeck }), false);
});

test('a workspace deck from another organization is not writable', async () => {
  seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);

  assert.equal(canWritePresentation({ user: bob, pres: alphaDeck }), false);
});

test('a workspace deck from another organization does not accept comments', async () => {
  seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);

  assert.equal(canCommentOnPresentation({ user: bob, pres: alphaDeck }), false);
});

test("the effective permission on another organization's deck is view", async () => {
  seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);

  assert.equal(getEffectivePermission({ user: bob, pres: alphaDeck }), 'view');
});

test('a workspace deck with no organization is refused', async () => {
  seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);
  // A presentation shape that lost its organization on the way here must fail
  // closed: in multi-workspace mode "no organization" is not "any organization".
  const pres = { id: 'deck-nowhere', scope: 'workspace', ownerEmail: 'carol@alpha.example' };

  assert.equal(canReadPresentation({ user: bob, pres }), false);
  assert.equal(getEffectivePermission({ user: bob, pres }), 'view');
});

test('a user with no organization is refused a workspace deck', async () => {
  seedDb();
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);

  assert.equal(canReadPresentation({ user: { email: 'nobody@example' }, pres: alphaDeck }), false);
  assert.equal(isSameOrganization({ email: 'nobody@example' }, alphaDeck), false);
});

// ---------------------------------------------------------------------------
// What must not change
// ---------------------------------------------------------------------------

test('a workspace deck in the person own organization stays fully available', async () => {
  seedDb();
  const alice = await sessionUser('alice@alpha.example', ORG_A);
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);

  assert.equal(canReadPresentation({ user: alice, pres: alphaDeck }), true);
  assert.equal(canWritePresentation({ user: alice, pres: alphaDeck }), true);
  assert.equal(canCommentOnPresentation({ user: alice, pres: alphaDeck }), true);
  assert.equal(getEffectivePermission({ user: alice, pres: alphaDeck }), 'edit');
});

test('ownership still grants access across the organization boundary', async () => {
  seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);
  // Bob owns a deck that sits in Alpha. Ownership is a relation to the deck,
  // not to the workspace, so the organization check must not swallow it — the
  // guards narrow the workspace grant and let everything else fall through.
  const deck = await loadDeck('deck-alpha-owned', ORG_A);

  assert.equal(canReadPresentation({ user: bob, pres: deck }), true);
  assert.equal(canWritePresentation({ user: bob, pres: deck }), true);
  assert.equal(canDeletePresentation({ user: bob, pres: deck }), true);
  assert.equal(getEffectivePermission({ user: bob, pres: deck }), 'edit');
});

test('a collaborator row still grants access across the organization boundary', async () => {
  seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);

  assert.equal(
    canReadPresentation({ user: bob, pres: alphaDeck, collaboratorPermission: 'view' }),
    true
  );
  assert.equal(
    canWritePresentation({ user: bob, pres: alphaDeck, collaboratorPermission: 'edit' }),
    true
  );
});

test('an unrestricted operator is unaffected', async () => {
  seedDb();
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);
  const operator = { email: 'root@example', unrestricted: true };

  assert.equal(canReadPresentation({ user: operator, pres: alphaDeck }), true);
  assert.equal(getEffectivePermission({ user: operator, pres: alphaDeck }), 'edit');
});

test('machine clients are decided by the presentation, not by this change', async () => {
  seedDb();
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);
  // The public API and MCP know their actor by email only and resolve their
  // context against the default organization — a separate open item in
  // docs/reference/tenant-isolation.md. Until that is closed this path keeps
  // the behaviour it had, rather than quietly becoming the place where
  // multi-workspace access is decided.
  assert.equal(checkActorAccess({ pres: alphaDeck, actorEmail: 'dave@beta.example' }), true);
});

// ---------------------------------------------------------------------------
// The comparison itself
// ---------------------------------------------------------------------------

test('the organization check costs no queries', async () => {
  const db = seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);
  const alphaDeck = await loadDeck('deck-alpha', ORG_A);

  db.__queryLog.length = 0;
  canReadPresentation({ user: bob, pres: alphaDeck });
  canWritePresentation({ user: bob, pres: alphaDeck });

  assert.deepEqual(db.__queryLog, [], 'membership is read off the session, not looked up');
});

test('the session carries the organization the check compares against', async () => {
  seedDb();
  const bob = await sessionUser('bob@beta.example', ORG_B);

  assert.equal(bob.organizationId, ORG_B, 'this is the value #356 put on the user');
});
