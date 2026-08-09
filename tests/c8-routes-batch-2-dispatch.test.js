/**
 * A7.19 C8 fase 2 — batch 2 route-table migration.
 *
 * These four modules mix the two documented forms (docs/reference/route-dispatch.md):
 * `/search`, `/providers` fall through on a method mismatch (Form A), while the
 * paths that sent an explicit 405 keep it via a trailing catch-all row (Form B),
 * and the guard-before-method paths (`/users/profiles`, `/settings/me`) stay as
 * single no-method handlers. `data-sources` and `activity` keep a module-wide
 * guard (feature flag / auth) that runs before dispatch.
 *
 * Routing is asserted with `select()` over the exported ROUTES (storage-free);
 * 405/401 behaviour is asserted by invoking the entry (or the catch-all row)
 * with a wrong method — which never reaches a real storage handler.
 *
 * Run with: node --test tests/c8-routes-batch-2-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES as SETTINGS_ROUTES, handleSettings } from '../server/routes/api/settings.js';
import { ROUTES as USERS_ROUTES, handleUsers } from '../server/routes/api/users.js';
import { ROUTES as DS_ROUTES, handleDataSources } from '../server/routes/api/data-sources.js';
import { ROUTES as ACT_ROUTES, handleActivity } from '../server/routes/api/activity.js';

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
  return { statusCode: null, writeHead(c) { this.statusCode = c; }, end() {}, setHeader() {} };
}

function ctx(method, pathname, authedUser = { email: 'a@b.test' }) {
  const res = mockRes();
  return {
    res,
    ctx: {
      repoRoot: '/tmp',
      storageScope: {},
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

// ─── settings (no module guard; Form B on app/organization; /me combined) ───

test('settings: routes resolve to their named handlers in order', () => {
  named(SETTINGS_ROUTES, 'GET', '/api/settings/app', 'handleAppSettingsGet');
  named(SETTINGS_ROUTES, 'PUT', '/api/settings/app', 'handleAppSettingsPut');
  named(SETTINGS_ROUTES, 'GET', '/api/settings/organization', 'handleOrgSettingsGet');
  named(SETTINGS_ROUTES, 'PATCH', '/api/settings/organization', 'handleOrgSettingsPatch');
  named(SETTINGS_ROUTES, 'GET', '/api/settings/me', 'handleMySettings');
});

test('settings: a wrong method still 405s (Form B + /me guard)', async () => {
  for (const [method, path] of [
    ['DELETE', '/api/settings/app'],
    ['POST', '/api/settings/organization'],
    ['DELETE', '/api/settings/me'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleSettings(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
  }
});

test('settings: an unknown sub-path falls through', async () => {
  const { ctx: c } = ctx('GET', '/api/settings/nope');
  assert.equal(await handleSettings(c), false);
});

// ─── users (Form A /search; guard-before-method /profiles) ───

test('users: routes resolve to their named handlers', () => {
  named(USERS_ROUTES, 'GET', '/api/users/search', 'handleUserSearch');
  named(USERS_ROUTES, 'GET', '/api/users/profiles', 'handleUserProfiles');
});

test('users: /search is GET-only and falls through on a wrong method', async () => {
  assert.equal(select(USERS_ROUTES, 'POST', '/api/users/search'), null);
  const { ctx: c } = ctx('POST', '/api/users/search');
  assert.equal(await handleUsers(c), false);
});

test('users: /profiles keeps auth-before-method (401 unauth, 405 wrong method)', async () => {
  const unauth = ctx('POST', '/api/users/profiles', { email: '' });
  await handleUsers(unauth.ctx);
  assert.equal(unauth.res.statusCode, 401, 'no email → 401, not 405');

  const wrongMethod = ctx('POST', '/api/users/profiles');
  await handleUsers(wrongMethod.ctx);
  assert.equal(wrongMethod.res.statusCode, 405, 'authed + wrong method → 405');
});

// ─── data-sources (module feature guard; Form A /providers, Form B rest) ───

test('data-sources: routes resolve to their named handlers', () => {
  named(DS_ROUTES, 'GET', '/api/data-sources/providers', 'handleProviders');
  named(DS_ROUTES, 'POST', '/api/data-sources/preview', 'handleDataSourcePreview');
  named(DS_ROUTES, 'POST', '/api/data-sources/refresh', 'handleDataSourceRefresh');
});

test('data-sources: the preview/refresh 405 catch-alls emit 405', () => {
  for (const path of ['/api/data-sources/preview', '/api/data-sources/refresh']) {
    const route = select(DS_ROUTES, 'GET', path);
    assert.ok(route && route.handler.name !== 'handleDataSourcePreview');
    const res = mockRes();
    route.handler({ res });
    assert.equal(res.statusCode, 405, `GET ${path} → 405 catch-all`);
  }
});

test('data-sources: the module prefix guard falls through for foreign paths', () => {
  const { ctx: c } = ctx('GET', '/api/not-data-sources');
  assert.equal(handleDataSources(c), false);
});

// ─── activity (module email guard; all three Form B) ───

test('activity: routes resolve to their named handlers', () => {
  named(ACT_ROUTES, 'GET', '/api/activity', 'handleActivityList');
  named(ACT_ROUTES, 'GET', '/api/activity/unread-count', 'handleUnreadCount');
  named(ACT_ROUTES, 'POST', '/api/activity/mark-read', 'handleMarkRead');
});

test('activity: the module auth guard 401s before dispatch', () => {
  const { ctx: c, res } = ctx('GET', '/api/activity', null);
  handleActivity(c);
  assert.equal(res.statusCode, 401, 'no user → 401 for any activity path');
});

test('activity: a wrong method 405s on each path (authed)', async () => {
  for (const [method, path] of [
    ['POST', '/api/activity'],
    ['DELETE', '/api/activity/unread-count'],
    ['GET', '/api/activity/mark-read'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleActivity(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
  }
});

test('activity: an unknown sub-path falls through (authed)', async () => {
  const { ctx: c } = ctx('GET', '/api/activity/nope');
  assert.equal(await handleActivity(c), false);
});
