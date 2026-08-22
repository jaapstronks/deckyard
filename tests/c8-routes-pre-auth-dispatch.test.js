/**
 * A7.19 C8 fase 2 — pre-auth family route-table migration
 * (auth, password-reset, magic-link, sso).
 *
 * These modules run **before** the auth gate, so the migration is deliberately
 * mechanical: Form A everywhere (every old branch fell through on a method
 * mismatch, no 405), order copied line for line, and every guard (auth-enabled,
 * rate limit, enumeration masking, OIDC state) stays inside its handler
 * untouched.
 *
 * Routing is asserted with `select()` over the exported tables
 * (storage-free); wrong-method and unknown-path fall-through is asserted by
 * invoking the entry functions — no row matches, so no handler (and no
 * storage) is reached. The fifth family this file covered, leads, went with
 * the lead-capture strip (B119).
 *
 * Run with: node --test tests/c8-routes-pre-auth-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTES as AUTH_ROUTES,
  handleAuth,
} from '../server/routes/api/auth.js';
import {
  ROUTES as RESET_ROUTES,
  handlePasswordReset,
} from '../server/routes/api/password-reset.js';
import {
  ROUTES as MAGIC_ROUTES,
  handleMagicLink,
} from '../server/routes/api/magic-link.js';
import { ROUTES as SSO_ROUTES, handleSso } from '../server/routes/api/sso.js';

function select(routes, method, pathname) {
  for (const route of routes) {
    if (route.method && method !== route.method) continue;
    if (typeof route.pattern === 'string') {
      if (pathname !== route.pattern) continue;
      return route;
    }
    if (!route.pattern.exec(pathname)) continue;
    return route;
  }
  return null;
}

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    writeHead(c, headers) {
      this.statusCode = c;
      Object.assign(this.headers, headers);
    },
    end() {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

function ctx(method, pathname, { authedUser = null } = {}) {
  const res = mockRes();
  return {
    res,
    ctx: {
      repoRoot: '/tmp',
      authedUser,
      req: { method, headers: {} },
      res,
      url: { pathname, searchParams: new URLSearchParams() },
    },
  };
}

function named(routes, method, path, handlerName) {
  const route = select(routes, method, path);
  assert.ok(route, `${method} ${path} matches a route`);
  assert.equal(
    route.handler.name,
    handlerName,
    `${method} ${path} → ${handlerName}`,
  );
}

test('auth: routes resolve to their named handlers in order', () => {
  named(AUTH_ROUTES, 'GET', '/api/auth/config', 'handleAuthConfig');
  named(AUTH_ROUTES, 'POST', '/api/auth/dev-login', 'handleDevLogin');
  named(AUTH_ROUTES, 'POST', '/api/auth/login', 'handleLogin');
  named(AUTH_ROUTES, 'POST', '/api/auth/logout', 'handleLogout');
  named(AUTH_ROUTES, 'GET', '/api/auth/me', 'handleAuthMe');
});

test('auth: a wrong method falls through (no 405, storage-free)', async () => {
  for (const [method, path] of [
    ['POST', '/api/auth/config'],
    ['GET', '/api/auth/login'],
    ['GET', '/api/auth/logout'],
    ['POST', '/api/auth/me'],
    ['DELETE', '/api/auth/login'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    assert.equal(await handleAuth(c), false, `${method} ${path} → false`);
    assert.equal(res.statusCode, null, `${method} ${path} sent no response`);
  }
});

test('password-reset: routes resolve to their named handlers in order', () => {
  named(
    RESET_ROUTES,
    'POST',
    '/api/auth/forgot-password',
    'handleForgotPassword',
  );
  named(
    RESET_ROUTES,
    'GET',
    '/api/auth/reset-password/validate',
    'handleResetPasswordValidate',
  );
  named(
    RESET_ROUTES,
    'POST',
    '/api/auth/reset-password',
    'handleResetPassword',
  );
  named(
    RESET_ROUTES,
    'POST',
    '/api/auth/change-password',
    'handleChangePassword',
  );
});

test('password-reset: /reset-password does not swallow /reset-password/validate', () => {
  // Exact-string patterns cannot prefix-match, but pin it anyway: the
  // validate row must keep answering GET while the reset row takes POST.
  named(
    RESET_ROUTES,
    'GET',
    '/api/auth/reset-password/validate',
    'handleResetPasswordValidate',
  );
  named(
    RESET_ROUTES,
    'POST',
    '/api/auth/reset-password',
    'handleResetPassword',
  );
  assert.equal(
    select(RESET_ROUTES, 'POST', '/api/auth/reset-password/validate'),
    null,
  );
});

test('password-reset: a wrong method falls through (no 405, storage-free)', async () => {
  for (const [method, path] of [
    ['GET', '/api/auth/forgot-password'],
    ['POST', '/api/auth/reset-password/validate'],
    ['GET', '/api/auth/reset-password'],
    ['GET', '/api/auth/change-password'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    assert.equal(
      await handlePasswordReset(c),
      false,
      `${method} ${path} → false`,
    );
    assert.equal(res.statusCode, null, `${method} ${path} sent no response`);
  }
});

test('magic-link: routes resolve to their named handlers in order', () => {
  named(MAGIC_ROUTES, 'POST', '/api/auth/magic-link', 'handleMagicLinkRequest');
  named(
    MAGIC_ROUTES,
    'POST',
    '/api/auth/magic-link/verify',
    'handleMagicLinkVerify',
  );
});

test('magic-link: a wrong method falls through (no 405, storage-free)', async () => {
  for (const [method, path] of [
    ['GET', '/api/auth/magic-link'],
    ['GET', '/api/auth/magic-link/verify'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    assert.equal(await handleMagicLink(c), false, `${method} ${path} → false`);
    assert.equal(res.statusCode, null, `${method} ${path} sent no response`);
  }
});

test('sso: routes resolve to their named handlers in order', () => {
  named(SSO_ROUTES, 'GET', '/api/auth/oidc/login', 'handleOidcLogin');
  named(SSO_ROUTES, 'GET', '/api/auth/oidc/callback', 'handleOidcCallback');
});

test('sso: outside the prefix the module declines; inside, unknown paths and wrong methods fall through', async () => {
  const outside = ctx('GET', '/api/auth/login');
  assert.equal(
    await handleSso(outside.ctx),
    false,
    'non-OIDC auth path declined',
  );

  for (const [method, path] of [
    ['POST', '/api/auth/oidc/login'],
    ['POST', '/api/auth/oidc/callback'],
    ['GET', '/api/auth/oidc/unknown'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    assert.equal(await handleSso(c), false, `${method} ${path} → false`);
    assert.equal(res.statusCode, null, `${method} ${path} sent no response`);
  }
});
