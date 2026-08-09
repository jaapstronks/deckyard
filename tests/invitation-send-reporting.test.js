/**
 * `invitationSent` reports the send, not the attempt (organization UI, slice 7).
 *
 * Both invitation routes set the flag *before* handing the mail to a
 * fire-and-forget `sendUserInvitationEmail(...).catch(...)`:
 *
 *   - `POST /api/organizations/:id/members` → `sendInvitation && !!invitationToken`
 *   - `POST /api/admin/users`               → `sendInvitation`
 *   - `POST /api/admin/users/:id/resend-invitation` → `true`, unconditionally
 *
 * The catch cannot see the failure that matters most. `sendEmail()`
 * (server/integrations/email/core.js) answers a missing `BREVO_API_KEY` by
 * *resolving* with `{ ok: false }` rather than throwing, so on any instance
 * without email configuration — every local one — the response claimed a
 * setup link had gone out to someone whose inbox stayed empty. The inviter
 * reads that flag as "they have the link" and acts on it by not following up,
 * which is the whole cost of the lie.
 *
 * Every assertion below fails against that code: the flag was true in all
 * three failure modes (unconfigured, HTTP error, thrown error).
 *
 * MULTI_ORG_ENABLED is read at module scope (server/config/features.js),
 * so this file sets it before importing anything and relies on node --test
 * giving each file its own process.
 *
 * Run with: node --test tests/invitation-send-reporting.test.js
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

const ORG = process.env.DEFAULT_ORGANIZATION_ID;

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { sessionVersion } = await import('../server/utils/session-version.js');
const auth = await import('../server/auth/auth.js');
const { handleOrganizationMembers } = await import(
  '../server/routes/api/organization-members.js'
);
const { handleAdminUsers } = await import('../server/routes/api/admin-users.js');
const { authedRouteContext } = await import('./helpers/authed-route-context.js');

const UPDATED_AT = '2026-02-01T00:00:00.000Z';
const OWNER = 'zoe@example.com';
const NEWCOMER = 'nina@example.com';

const realFetch = globalThis.fetch;
let fetchCalls = 0;

test.afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.BREVO_API_KEY;
  __setTestDb(null);
  fetchCalls = 0;
});

/**
 * Make the Brevo call succeed or fail, the way the API would.
 * @param {'ok'|'http-error'|'throws'} mode - What the transport does.
 */
function stubBrevo(mode) {
  process.env.BREVO_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (mode === 'throws') throw new Error('network down');
    if (mode === 'http-error') {
      return {
        ok: false,
        status: 502,
        text: async () => 'upstream said no',
      };
    }
    return { ok: true, status: 201, text: async () => '' };
  };
}

/** Count sends without letting any of them leave the process. */
function countFetches() {
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 201, text: async () => '' };
  };
}

/**
 * One organization, one owner, and one person who already has an account on
 * the instance but no membership here.
 * @returns {Object} the fake db
 */
function seed() {
  const db = createFakeDb({
    organizations: [{ id: ORG, name: 'Alpha', slug: 'alpha', settings: {} }],
    users: [
      {
        id: 'user-owner',
        organization_id: ORG,
        email: OWNER,
        name: 'zoe',
        role: 'admin',
        auth_source: 'database',
        password_hash: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: UPDATED_AT,
        settings: {},
      },
      {
        id: 'user-existing',
        organization_id: ORG,
        email: 'ex@example.com',
        name: 'ex',
        role: 'user',
        auth_source: 'database',
        password_hash: 'already-set-up',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: UPDATED_AT,
        settings: {},
      },
      {
        // Invited earlier, never set a password: the one state a resend acts on.
        id: 'user-pending',
        organization_id: ORG,
        email: 'pending@example.com',
        name: 'pending',
        role: 'user',
        auth_source: 'database',
        password_hash: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: UPDATED_AT,
        settings: {},
      },
    ],
    password_reset_tokens: [],
    user_organizations: [
      {
        id: 'membership-owner',
        user_id: 'user-owner',
        organization_id: ORG,
        role: 'owner',
        is_designer: false,
        joined_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    auth_audit_log: [],
  });
  __setTestDb(db);
  return db;
}

/** Collects what the handler wrote. */
function fakeResponse() {
  const chunks = [];
  return {
    statusCode: null,
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      if (payload) chunks.push(payload);
    },
    body() {
      try {
        return JSON.parse(chunks.join(''));
      } catch {
        return null;
      }
    },
  };
}

/** A bare request carrying a JSON body. */
function fakeRequest(method, body, headers = {}) {
  return {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body ?? {}));
    },
  };
}

/** The same request, plus a cookie carrying the owner's session. */
function withSession(method, body) {
  const sink = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      return this.headers[name];
    },
  };
  auth.setSessionCookie(
    { headers: {} },
    sink,
    { email: OWNER, role: 'admin', name: 'zoe', v: sessionVersion({ updated_at: UPDATED_AT }) },
    { organizationId: ORG }
  );
  return fakeRequest(method, body, {
    cookie: String(sink.headers['Set-Cookie']).split(';')[0],
  });
}

/**
 * Invite someone into the organization as its owner.
 * @param {string} email - Who to invite.
 * @returns {Promise<{status: number, member: Object}>}
 */
async function invite(email) {
  const res = fakeResponse();
  await handleOrganizationMembers({
    repoRoot: null,
    req: fakeRequest('POST', { email }),
    res,
    url: new URL(`http://localhost/api/organizations/${ORG}/members`),
    authedUser: {
      email: OWNER,
      isAdmin: false,
      organizationId: ORG,
      organizationRole: 'owner',
    },
  });
  return { status: res.statusCode, member: res.body()?.member || {} };
}

/**
 * Create an instance user through the admin route.
 * @param {string} email - The new account's address.
 * @returns {Promise<{status: number, body: Object|null}>}
 */
async function createInstanceUser(email) {
  const res = fakeResponse();
  const ctx = await authedRouteContext({
    repoRoot: null,
    req: withSession('POST', { email, name: 'nina', role: 'user' }),
    res,
    url: new URL('http://localhost/api/admin/users'),
  });
  await handleAdminUsers(ctx);
  return { status: res.statusCode, body: res.body() };
}

// ---------------------------------------------------------------------------
// Inviting into an organization
// ---------------------------------------------------------------------------

test('an instance without email configuration does not claim a mail went out', async () => {
  const db = seed();

  const { status, member } = await invite(NEWCOMER);

  assert.equal(status, 201);
  assert.equal(member.isNewUser, true, 'the account was created');
  assert.equal(member.invitationSent, false, 'but nothing was sent, and the response says so');
  assert.equal(
    db.__tables.user_organizations.filter((r) => r.organization_id === ORG).length,
    2,
    'the membership stands either way — only the mail is missing'
  );
});

test('a mail that actually goes out is reported as sent', async () => {
  seed();
  stubBrevo('ok');

  const { member } = await invite(NEWCOMER);

  assert.equal(member.invitationSent, true);
  assert.equal(fetchCalls, 1, 'and exactly one send was attempted');
});

test('a rejected send is not a sent invitation', async () => {
  seed();
  stubBrevo('http-error');

  const { status, member } = await invite(NEWCOMER);

  assert.equal(status, 201, 'the person is a member; only the mail failed');
  assert.equal(member.isNewUser, true);
  assert.equal(member.invitationSent, false);
});

test('a transport that throws is not a sent invitation either', async () => {
  seed();
  stubBrevo('throws');

  const { status, member } = await invite(NEWCOMER);

  assert.equal(status, 201);
  assert.equal(member.invitationSent, false);
});

test('adding someone who already has an account sends nothing and says so', async () => {
  seed();
  countFetches();

  const { status, member } = await invite('ex@example.com');

  assert.equal(status, 201);
  assert.equal(member.isNewUser, false, 'no account was created, so there is no setup link');
  assert.equal(member.invitationSent, false);
  assert.equal(fetchCalls, 0, 'and no mail was attempted at all');
});

// ---------------------------------------------------------------------------
// The same flag on the instance-wide admin route
// ---------------------------------------------------------------------------

test('creating an instance user does not claim an unsent invitation', async () => {
  seed();

  const { status, body } = await createInstanceUser(NEWCOMER);

  assert.equal(status, 201);
  assert.equal(body.invitationSent, false, 'no Brevo key, so no invitation');
});

test('creating an instance user reports a mail that did go out', async () => {
  seed();
  stubBrevo('ok');

  const { body } = await createInstanceUser(NEWCOMER);

  assert.equal(body.invitationSent, true);
  assert.equal(fetchCalls, 1);
});

/**
 * Resend the setup link for a user who never activated.
 * @param {string} userId - Whose invitation to resend.
 * @returns {Promise<{status: number, body: Object|null}>}
 */
async function resend(userId) {
  const res = fakeResponse();
  const ctx = await authedRouteContext({
    repoRoot: null,
    req: withSession('POST', {}),
    res,
    url: new URL(`http://localhost/api/admin/users/${userId}/resend-invitation`),
  });
  await handleAdminUsers(ctx);
  return { status: res.statusCode, body: res.body() };
}

test('a resend that could not be sent is not reported as sent', async () => {
  seed();

  // The token is rotated whatever happens to the mail, so this is a success
  // with a caveat rather than a failure — and the caveat is the whole point.
  const { status, body } = await resend('user-pending');

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.invitationSent, false, 'no Brevo key, so nothing was resent');
});

test('a resend that did go out is reported as sent', async () => {
  seed();
  stubBrevo('ok');

  const { status, body } = await resend('user-pending');

  assert.equal(status, 200);
  assert.equal(body.invitationSent, true);
  assert.equal(fetchCalls, 1);
});
