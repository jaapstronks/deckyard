/**
 * A7.19 C8 fase 0: the admin route modules (admin-users, admin-ai-logs,
 * email-templates) are mounted after the auth gate in routes/api/index.js and
 * receive the enriched AuthedContext, instead of re-resolving the caller
 * themselves with a second getUserFromRequestAsync.
 *
 * This pins the observable consequence: the caller and their capability now come
 * from `ctx.authedUser` — the same enriched user any other post-gate handler
 * sees. A request that carries an enriched, admin `authedUser` on the context
 * but no session cookie is served (before the change it 401'd, because the
 * handler ignored the context and found no session of its own); and a
 * non-admin `authedUser` is refused, proving the admin capability is read off
 * the context rather than re-derived.
 *
 * admin-ai-logs is used as the probe: its GET route has no request body, no
 * database access and no organization scope, so it exercises the context wiring
 * with nothing else in the way.
 *
 * Run with: node --test tests/admin-route-authed-context.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { handleAdminAiLogs } =
  await import('../server/routes/api/admin-ai-logs.js');

/** Collects what the handler wrote. */
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
      try {
        return JSON.parse(chunks.join(''));
      } catch {
        return null;
      }
    },
  };
}

/**
 * Build a post-gate context with the given user and no session cookie, so the
 * only identity available is the one on the context.
 *
 * @param {object|null} authedUser - The enriched user, as index.js would attach.
 * @param {string} [pathname] - Admin path under test.
 * @returns {object} The AuthedContext plus its response sink.
 */
function contextFor(authedUser, pathname = '/api/admin/ai-logs') {
  return {
    repoRoot: process.cwd(),
    storageScope: {
      organizationId: 'org-under-test',
      actorEmail: authedUser?.email,
      repoRoot: process.cwd(),
    },
    req: { method: 'GET', headers: {} }, // deliberately no cookie
    res: fakeResponse(),
    url: new URL(`http://localhost${pathname}`),
    authedUser,
  };
}

test('an admin route trusts the enriched user on the context, without a fresh lookup', async () => {
  const ctx = contextFor({
    email: 'admin@example.com',
    isAdmin: true,
    isDesigner: true,
    canEditCustomHtml: true,
    organizationId: 'org-under-test',
  });

  const handled = await handleAdminAiLogs(ctx);

  assert.equal(handled, true, 'the route handled the request');
  assert.equal(
    ctx.res.statusCode,
    200,
    'served from ctx.authedUser — no session cookie, yet not a 401',
  );
});

test('the admin capability is read off the context: a non-admin user is refused', async () => {
  const ctx = contextFor({
    email: 'designer@example.com',
    isAdmin: false,
    isDesigner: true,
    canEditCustomHtml: true,
    organizationId: 'org-under-test',
  });

  await handleAdminAiLogs(ctx);

  assert.equal(
    ctx.res.statusCode,
    401,
    'the isAdmin flag on the context gates the route',
  );
});

test('no user on the context is unauthenticated, not a server error', async () => {
  const ctx = contextFor(null);

  await handleAdminAiLogs(ctx);

  assert.equal(ctx.res.statusCode, 401, 'a null authedUser is refused cleanly');
});
