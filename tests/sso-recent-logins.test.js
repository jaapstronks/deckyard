/**
 * The in-memory list of recent SSO-login claims and its admin route (B551).
 *
 * Pins what the list keeps (claims minus the replay-binding ones, newest
 * first, at most MAX_ENTRIES, none older than TTL_MS) and who may read it
 * (an instance admin; not an organization admin without the instance role,
 * not an anonymous caller). The callback side, that a real login lands here
 * with its outcome, is in tests/sso-oidc-callback.test.js.
 *
 * Run with: node --test tests/sso-recent-logins.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  recordSsoLogin,
  listRecentSsoLogins,
  resetRecentSsoLogins,
  MAX_ENTRIES,
  TTL_MS,
} = await import('../server/auth/sso-recent-logins.js');
const { handleAdminSso } = await import('../server/routes/api/admin-sso.js');

test.afterEach(() => resetRecentSsoLogins());

test('a login is kept with its outcome, minus nonce, at_hash, c_hash and sid', () => {
  const now = Date.parse('2026-09-29T10:00:00.000Z');
  recordSsoLogin(
    {
      iss: 'https://idp.test',
      sub: 's1',
      email: 'a@example.com',
      groups: ['editors'],
      nonce: 'n',
      at_hash: 'h1',
      c_hash: 'h2',
      sid: 'session',
    },
    'ok',
    now,
  );
  assert.deepEqual(listRecentSsoLogins(now), [
    {
      at: '2026-09-29T10:00:00.000Z',
      email: 'a@example.com',
      outcome: 'ok',
      claims: {
        iss: 'https://idp.test',
        sub: 's1',
        email: 'a@example.com',
        groups: ['editors'],
      },
    },
  ]);
});

test('newest first, capped at MAX_ENTRIES', () => {
  for (let i = 0; i < MAX_ENTRIES + 3; i++) {
    recordSsoLogin({ email: `u${i}@example.com` }, 'ok', 1000 + i);
  }
  const list = listRecentSsoLogins(2000);
  assert.equal(list.length, MAX_ENTRIES);
  assert.equal(list[0].email, `u${MAX_ENTRIES + 2}@example.com`);
});

test('a login older than TTL_MS is gone', () => {
  recordSsoLogin({ email: 'old@example.com' }, 'ok', 0);
  recordSsoLogin({ email: 'new@example.com' }, 'email_unverified', TTL_MS);
  const list = listRecentSsoLogins(TTL_MS + 1);
  assert.deepEqual(
    list.map((l) => [l.email, l.outcome]),
    [['new@example.com', 'email_unverified']],
  );
});

test('a reader cannot change what is kept', () => {
  recordSsoLogin({ email: 'a@example.com', groups: ['x'] }, 'ok', 1);
  listRecentSsoLogins(2)[0].claims.groups.push('admin');
  assert.deepEqual(listRecentSsoLogins(2)[0].claims.groups, ['x']);
});

// ---------------------------------------------------------------------------
// GET /api/admin/sso/logins
// ---------------------------------------------------------------------------

function fakeResponse() {
  const chunks = [];
  return {
    statusCode: null,
    setHeader() {},
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      if (payload) chunks.push(payload);
    },
    body() {
      return JSON.parse(chunks.join(''));
    },
  };
}

async function get(authedUser) {
  const res = fakeResponse();
  const handled = await handleAdminSso({
    repoRoot: process.cwd(),
    req: { method: 'GET', headers: {} },
    res,
    url: new URL('http://localhost/api/admin/sso/logins'),
    authedUser,
  });
  return { handled, res };
}

test('an instance admin reads the list', async () => {
  recordSsoLogin({ email: 'a@example.com' }, 'ok');
  const { handled, res } = await get({
    email: 'root@example.com',
    isAdmin: true,
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const body = res.body();
  assert.equal(typeof body.enabled, 'boolean');
  assert.equal(body.logins[0].email, 'a@example.com');
});

test('an organization admin without the instance role is refused', async () => {
  const { res } = await get({
    email: 'orgadmin@example.com',
    isAdmin: false,
    organizationRole: 'admin',
  });
  assert.equal(res.statusCode, 403);
});

test('an anonymous caller is refused', async () => {
  const { res } = await get(null);
  assert.equal(res.statusCode, 401);
});
