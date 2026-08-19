/**
 * A7.19 C8 fase 2 — home route-table migration.
 *
 * `home.js` is the single-path `/api/home` module. It is Form B
 * (docs/reference/route-dispatch.md § when a guard runs before the method
 * check is the *inverse* case): the original ran its method check *before* the
 * auth check, so a wrong method 405'd while a missing user 401'd. The table
 * preserves that by putting an explicit 405 catch-all after the GET row — a
 * non-GET request reaches it before `handleHomeGet` runs its auth guard.
 *
 * All assertions are storage-free: the 405 catch-all only calls
 * methodNotAllowed, and the GET row's auth guard 401s before any storage read.
 *
 * Run with: node --test tests/c8-routes-home-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES, handleHome } from '../server/routes/api/home.js';

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

function ctx(method, { authedUser = { email: 'a@b.test' } } = {}) {
  const res = mockRes();
  return {
    res,
    ctx: {
      repoRoot: '/tmp',
      storageScope: {},
      authedUser,
      req: { method, headers: {} },
      res,
      url: { pathname: '/api/home', searchParams: new URLSearchParams() },
    },
  };
}

test('home: GET resolves to the aggregation handler', () => {
  const route = select(ROUTES, 'GET', '/api/home');
  assert.equal(route?.handler.name, 'handleHomeGet');
});

test('home: a wrong method 405s with Allow: GET (before the auth check)', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const { ctx: c, res } = ctx(method);
    assert.equal(await handleHome(c), true, `${method} handled by the 405 row`);
    assert.equal(res.statusCode, 405, `${method} /api/home → 405`);
    assert.equal(res.headers.Allow, 'GET', `${method} /api/home → Allow: GET`);
  }
});

test('home: GET without an authenticated user 401s (method matched first)', async () => {
  const { ctx: c, res } = ctx('GET', { authedUser: null });
  assert.equal(await handleHome(c), true);
  assert.equal(res.statusCode, 401, 'no user → 401, not 405');
});

test('home: an unknown path falls through', async () => {
  const c = {
    repoRoot: '/tmp',
    storageScope: {},
    authedUser: { email: 'a@b.test' },
    req: { method: 'GET', headers: {} },
    res: mockRes(),
    url: { pathname: '/api/homestead', searchParams: new URLSearchParams() },
  };
  assert.equal(await handleHome(c), false);
});
