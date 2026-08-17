/**
 * A7.19 C8 fase 2 — pre-auth family route-table migration
 * (auth, password-reset, magic-link, sso, leads).
 *
 * These modules run **before** the auth gate (leads also has a post-gate
 * mount), so the migration is deliberately mechanical: Form A everywhere
 * (every old branch fell through on a method mismatch, no 405), order copied
 * line for line, and every guard (auth-enabled, rate limit, enumeration
 * masking, OIDC state) stays inside its handler untouched.
 *
 * Routing is asserted with `select()` over the exported tables
 * (storage-free); wrong-method and unknown-path fall-through is asserted by
 * invoking the entry functions — no row matches, so no handler (and no
 * storage) is reached. The leads `:id`-shadows-`my-data` DELETE quirk is now
 * gone by construction (B63b): the three `my-data` routes live in the public
 * table, dispatched before the authed `:id` row, so no ordering discipline is
 * needed and the authed table carries no literal for `:id` to shadow.
 *
 * Run with: node --test tests/c8-routes-pre-auth-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES as AUTH_ROUTES, handleAuth } from '../server/routes/api/auth.js';
import { ROUTES as RESET_ROUTES, handlePasswordReset } from '../server/routes/api/password-reset.js';
import { ROUTES as MAGIC_ROUTES, handleMagicLink } from '../server/routes/api/magic-link.js';
import { ROUTES as SSO_ROUTES, handleSso } from '../server/routes/api/sso.js';
import {
  ROUTES as LEAD_ROUTES,
  PUBLIC_ROUTES as LEAD_PUBLIC_ROUTES,
  handleLeads,
  handleLeadsPublic,
} from '../server/routes/api/leads.js';

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
    writeHead(c, headers) { this.statusCode = c; Object.assign(this.headers, headers); },
    end() {},
    setHeader(k, v) { this.headers[k] = v; },
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
  assert.equal(route.handler.name, handlerName, `${method} ${path} → ${handlerName}`);
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
  named(RESET_ROUTES, 'POST', '/api/auth/forgot-password', 'handleForgotPassword');
  named(RESET_ROUTES, 'GET', '/api/auth/reset-password/validate', 'handleResetPasswordValidate');
  named(RESET_ROUTES, 'POST', '/api/auth/reset-password', 'handleResetPassword');
  named(RESET_ROUTES, 'POST', '/api/auth/change-password', 'handleChangePassword');
});

test('password-reset: /reset-password does not swallow /reset-password/validate', () => {
  // Exact-string patterns cannot prefix-match, but pin it anyway: the
  // validate row must keep answering GET while the reset row takes POST.
  named(RESET_ROUTES, 'GET', '/api/auth/reset-password/validate', 'handleResetPasswordValidate');
  named(RESET_ROUTES, 'POST', '/api/auth/reset-password', 'handleResetPassword');
  assert.equal(select(RESET_ROUTES, 'POST', '/api/auth/reset-password/validate'), null);
});

test('password-reset: a wrong method falls through (no 405, storage-free)', async () => {
  for (const [method, path] of [
    ['GET', '/api/auth/forgot-password'],
    ['POST', '/api/auth/reset-password/validate'],
    ['GET', '/api/auth/reset-password'],
    ['GET', '/api/auth/change-password'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    assert.equal(await handlePasswordReset(c), false, `${method} ${path} → false`);
    assert.equal(res.statusCode, null, `${method} ${path} sent no response`);
  }
});

test('magic-link: routes resolve to their named handlers in order', () => {
  named(MAGIC_ROUTES, 'POST', '/api/auth/magic-link', 'handleMagicLinkRequest');
  named(MAGIC_ROUTES, 'POST', '/api/auth/magic-link/verify', 'handleMagicLinkVerify');
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
  assert.equal(await handleSso(outside.ctx), false, 'non-OIDC auth path declined');

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

test('leads: the public table carries the submit route and the three my-data routes', () => {
  named(LEAD_PUBLIC_ROUTES, 'POST', '/api/leads', 'handleLeadSubmit');
  named(LEAD_PUBLIC_ROUTES, 'POST', '/api/leads/my-data/request', 'handleRequestMyData');
  named(LEAD_PUBLIC_ROUTES, 'GET', '/api/leads/my-data', 'handleGetMyData');
  named(LEAD_PUBLIC_ROUTES, 'DELETE', '/api/leads/my-data', 'handleDeleteMyData');
  assert.equal(LEAD_PUBLIC_ROUTES.length, 4);
  assert.equal(select(LEAD_PUBLIC_ROUTES, 'GET', '/api/leads'), null, 'GET /api/leads is not public');
});

test('leads: authed routes resolve to their named handlers in order', () => {
  named(LEAD_ROUTES, 'GET', '/api/presentations/p1/leads', 'handleGetLeads');
  named(LEAD_ROUTES, 'GET', '/api/presentations/p1/leads/count', 'handleGetLeadCount');
  named(LEAD_ROUTES, 'GET', '/api/presentations/p1/leads/export', 'handleExportLeads');
  named(LEAD_ROUTES, 'DELETE', '/api/leads/l1', 'handleDeleteLead');
  // The my-data routes are no longer in the authed table — they went public.
  assert.equal(select(LEAD_ROUTES, 'POST', '/api/leads/my-data/request'), null);
  assert.equal(select(LEAD_ROUTES, 'GET', '/api/leads/my-data'), null);
});

test('leads: the public my-data delete is not shadowed by the authed :id row', () => {
  // The literal my-data delete lives in the public table, matched before the
  // authed table is ever consulted. The authed `:id` row still matches any
  // single segment — but 'my-data' can no longer reach it, because the public
  // dispatch answers first. Here: the public table resolves the erasure, and
  // the authed table resolves a real lead id.
  named(LEAD_PUBLIC_ROUTES, 'DELETE', '/api/leads/my-data', 'handleDeleteMyData');
  named(LEAD_ROUTES, 'DELETE', '/api/leads/l1', 'handleDeleteLead');
  // And the authed table would still (wrongly) resolve a bare 'my-data' to the
  // :id handler if it were reached — which is exactly why the route is public.
  named(LEAD_ROUTES, 'DELETE', '/api/leads/my-data', 'handleDeleteLead');
});

test('leads: without a session the authed entry declines; unknown paths fall through', async () => {
  const anon = ctx('GET', '/api/presentations/p1/leads');
  assert.equal(await handleLeads(anon.ctx), false, 'no authedUser → false (gate answers)');

  const unknown = ctx('PATCH', '/api/leads/l1', { authedUser: { email: 'a@b.test' } });
  assert.equal(await handleLeads(unknown.ctx), false, 'wrong method on :id → false');

  const pub = ctx('POST', '/api/leads/other');
  assert.equal(await handleLeadsPublic(pub.ctx), false, 'unknown public path → false');
});
