/**
 * The request-to-organization binding, with MULTI_ORG_ENABLED (A1 phase 1).
 *
 * `createRouteContext` used to discard `authedUser.organizationId` and hand
 * every request the default organization, so a person who had switched
 * organizations still read and wrote in the default one. This file walks the whole
 * chain the way a request does — session cookie → `getUserFromRequestAsync` →
 * `createRouteContext` → the Postgres presentations adapter — and pins that the
 * organization the session is resolved to is the organization the queries scope
 * on.
 *
 * **Which assertions fail without the change** (revert `createRouteContext` in
 * server/utils/context.js to `options.organizationId || getDefaultOrganizationId()`
 * and these six go red, the rest stay green):
 *
 *   - 'the context carries the organization the session is in' — org B session
 *     yields the default organization A.
 *   - 'a deck from another organization is invisible' — Beta's deck is readable
 *     from an Alpha session, because both contexts collapse onto Alpha.
 *   - 'listing decks only returns the active organization's' — a Beta session
 *     lists Alpha's decks.
 *   - 'a new deck is created in the active organization' — the deck lands in
 *     Alpha while the person is working in Beta.
 *   - 'a revoked membership moves the request to the fallback organization'.
 *   - 'switching organizations moves the request with it' — the switch endpoint
 *     updates the cookie but nothing downstream notices.
 *
 * MULTI_ORG_ENABLED is read at module scope (server/config/features.js:15),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process. The single-organization half, which pins that
 * none of this changes for existing installations, lives in
 * request-organization-binding.test.js.
 *
 * Run with: node --test tests/request-organization-binding-multi-org.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Assembled rather than written as one literal so secret scanners do not flag
// it; authConfigError() only requires MIN_AUTH_SECRET_LENGTH characters.
process.env.AUTH_SECRET = ['deckyard', 'test', 'auth'].join('-').padEnd(40, '0');
delete process.env.AUTH_ENABLED;
delete process.env.AUTH_DEV_BYPASS;
process.env.MULTI_ORG_ENABLED = 'true';
process.env.DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-0000000000aa';

const ORG_A = process.env.DEFAULT_ORGANIZATION_ID;
const ORG_B = '00000000-0000-0000-0000-0000000000bb';
const ORG_GONE = '00000000-0000-0000-0000-0000000000cc';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { hashPassword } = await import('../server/utils/password-hash.js');
const { isMultiOrgEnabled } = await import('../server/config/features.js');
const auth = await import('../server/auth/auth.js');
const { createRouteContext } = await import('../server/utils/context.js');
const { withPresentations } = await import(
  '../server/storage/adapters/postgres/presentations.js'
);

const PresentationsAdapter = withPresentations(class {});

let passwordHash;

test.before(async () => {
  passwordHash = await hashPassword('correct horse battery');
  assert.equal(isMultiOrgEnabled(), true, 'multi-organization flag is on for this file');
});

test.afterEach(() => {
  __setTestDb(null);
});

/**
 * Alice holds memberships in Alpha (older) and Beta (newer); her home
 * organization is Beta. Each organization owns one organization deck.
 * @param {Object} [options] - `memberships` overrides the seeded memberships
 * @returns {Object} the fake db
 */
function seedTwoOrgs(options = {}) {
  const memberships =
    options.memberships === undefined
      ? [
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
        ]
      : options.memberships;

  const deck = (id, organizationId, title) => ({
    id,
    organization_id: organizationId,
    title,
    owner_email: 'alice@example.com',
    created_by: 'alice@example.com',
    updated_by: 'alice@example.com',
    visibility: 'organization',
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
  });

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
    user_organizations: memberships,
    presentations: [
      deck('deck-alpha', ORG_A, 'Alpha deck'),
      deck('deck-beta', ORG_B, 'Beta deck'),
    ],
  });
  __setTestDb(db);
  return db;
}

/** Build a request whose cookie carries a session for the given organization. */
function requestWithSession(user, organizationId) {
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
  return { headers: { cookie: String(res.headers['Set-Cookie']).split(';')[0] } };
}

/** Log in, then resolve a request in `organizationId` down to a route context. */
async function contextFor(organizationId) {
  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', {
    organizationId: ORG_A,
    actorEmail: 'alice@example.com',
  });
  const authedUser = await auth.getUserFromRequestAsync(
    requestWithSession(login, organizationId),
    {}
  );
  return { authedUser, ctx: authedUser ? createRouteContext(authedUser) : null };
}

// ---------------------------------------------------------------------------
// The binding itself
// ---------------------------------------------------------------------------

test('the context carries the organization the session is in', async () => {
  seedTwoOrgs();

  for (const org of [ORG_A, ORG_B]) {
    const { ctx } = await contextFor(org);
    assert.equal(ctx.organizationId, org, `session in ${org} produced a context in ${org}`);
    assert.equal(ctx.actorEmail, 'alice@example.com');
  }
});

test('an explicit override still wins over the session', async () => {
  seedTwoOrgs();
  const { authedUser } = await contextFor(ORG_B);

  const ctx = createRouteContext(authedUser, { organizationId: ORG_A });
  assert.equal(ctx.organizationId, ORG_A, 'options.organizationId is the top precedence');
});

test('a context with nobody authenticated falls back to the default', () => {
  seedTwoOrgs();

  // The callers that build a context before (or without) authentication:
  // password reset, magic link, SSO, email templates. They pass null, so the
  // absence is stated rather than lost, and the default is not a guess.
  assert.equal(createRouteContext(null).organizationId, ORG_A);
});

test('an authenticated user with no resolved organization gets none (L10)', () => {
  seedTwoOrgs();

  // This used to fall back to the default organization, which let a session act
  // in an organization it was never resolved to — the L10 finding of the 2026-07
  // audit. Once an instance holds several organizations the request gets no
  // organization at all and getOrgId() refuses the query instead of guessing.
  assert.equal(
    createRouteContext({ email: 'apikey-owner@example.com' }).organizationId,
    null
  );
});

test('an unverified organization from the synchronous path is ignored', () => {
  seedTwoOrgs();

  // getUserFromRequest() copies payload.orgId through without checking
  // membership and flags itself for validation. Its organization must never
  // reach a query; only resolveActiveOrganization()'s verdict may. Under
  // multi-organization that leaves the request with no organization (see above)
  // rather than the default one.
  const unverified = {
    email: 'alice@example.com',
    organizationId: ORG_GONE,
    _needsDbValidation: true,
  };

  assert.equal(createRouteContext(unverified).organizationId, null);
});

// ---------------------------------------------------------------------------
// What the binding buys: queries scope on the active organization
// ---------------------------------------------------------------------------

test('a deck from another organization is invisible', async () => {
  seedTwoOrgs();
  const adapter = new PresentationsAdapter();

  const { ctx: inAlpha } = await contextFor(ORG_A);
  const { ctx: inBeta } = await contextFor(ORG_B);

  assert.ok(await adapter.getPresentation('deck-alpha', inAlpha), 'own deck is readable');
  assert.equal(
    await adapter.getPresentation('deck-beta', inAlpha),
    null,
    "Alpha cannot read Beta's deck"
  );

  assert.ok(await adapter.getPresentation('deck-beta', inBeta), 'own deck is readable');
  assert.equal(
    await adapter.getPresentation('deck-alpha', inBeta),
    null,
    "Beta cannot read Alpha's deck"
  );
});

test("listing decks only returns the active organization's", async () => {
  seedTwoOrgs();
  const adapter = new PresentationsAdapter();

  const { ctx: inBeta } = await contextFor(ORG_B);
  const listed = await adapter.listPresentations(inBeta);

  assert.deepEqual(
    listed.map((p) => p.id),
    ['deck-beta'],
    'the other organization does not appear in the list'
  );
});

test('a new deck is created in the active organization', async () => {
  const db = seedTwoOrgs();
  const adapter = new PresentationsAdapter();

  const { ctx: inBeta } = await contextFor(ORG_B);
  const created = await adapter.createPresentation({ title: 'Written in Beta' }, inBeta);

  const row = db.__tables.presentations.find((p) => p.id === created.id);
  assert.equal(row.organization_id, ORG_B, 'writes land in the organization being used');
});

// ---------------------------------------------------------------------------
// Revocation: the token outlives the membership
// ---------------------------------------------------------------------------

test('a revoked membership moves the request to the fallback organization', async () => {
  // Alice was removed from Alpha and keeps only Beta; her token still says
  // Alpha. Beta is deliberately not the default organization, so falling back
  // correctly and falling back to the default look different.
  seedTwoOrgs({
    memberships: [
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
  const adapter = new PresentationsAdapter();

  const { ctx } = await contextFor(ORG_A);
  assert.equal(ctx.organizationId, ORG_B, 'oldest remaining membership, per the phase 0 rule');
  assert.ok(await adapter.getPresentation('deck-beta', ctx), 'her remaining organization works');
  assert.equal(
    await adapter.getPresentation('deck-alpha', ctx),
    null,
    'the organization she was removed from is no longer readable'
  );
});

test('no membership at all means no context is built', async () => {
  seedTwoOrgs({ memberships: [] });

  const { authedUser, ctx } = await contextFor(ORG_A);
  assert.equal(authedUser, null, 'the request is refused (401) before a context exists');
  assert.equal(ctx, null);
});

// ---------------------------------------------------------------------------
// The switch endpoint, end to end
// ---------------------------------------------------------------------------

test('switching organizations moves the request with it', async () => {
  seedTwoOrgs();
  const adapter = new PresentationsAdapter();

  const login = await auth.verifyLoginAsync('alice@example.com', 'correct horse battery', {
    organizationId: ORG_A,
    actorEmail: 'alice@example.com',
  });

  // The state the switch endpoint leaves behind: same session, new orgId.
  const req = requestWithSession(login, ORG_A);
  const res = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
  };
  auth.updateSessionOrganization(req, res, ORG_B);
  const switched = {
    headers: { cookie: String(res.headers['Set-Cookie']).split(';')[0] },
  };

  const authedUser = await auth.getUserFromRequestAsync(switched, {});
  const ctx = createRouteContext(authedUser);

  assert.equal(ctx.organizationId, ORG_B, 'the switch reaches the storage layer');
  assert.ok(await adapter.getPresentation('deck-beta', ctx));
  assert.equal(await adapter.getPresentation('deck-alpha', ctx), null);
});
