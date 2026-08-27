/**
 * A7.19 C8 fase 2 — route-table migration for the admin, organization and
 * collection modules (batch 4).
 *
 * Eight modules, mixing the documented forms (docs/reference/route-dispatch.md):
 * `slide-collections` and `custom-slide-types` sent explicit 405s per path
 * group (Form B trailing catch-alls); `organizations`, `notifications`,
 * `admin-users`, `admin-ai-logs` and `email-templates` fell through on a
 * method mismatch (Form A, no 405 rows); `live-session-audience` mixes both —
 * `/state` and `/events` fall through on purpose (their POST counterparts are
 * presenter actions mounted behind the login gate), `/deck` and `/notes` keep
 * their explicit 405.
 *
 * Routing is asserted with `select()` over the exported ROUTES (storage-free);
 * 405/401/403 behaviour is asserted by invoking the entry function — which for
 * a wrong method or failing guard never reaches a real storage handler.
 *
 * Run with: node --test tests/route-dispatch-admin-and-collections.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTES as SC_ROUTES,
  handleSlideCollections,
} from '../server/routes/api/slide-collections.js';
import {
  ROUTES as ORG_ROUTES,
  handleOrganizations,
} from '../server/routes/api/organizations.js';
import {
  ROUTES as NOTIF_ROUTES,
  handleNotifications,
} from '../server/routes/api/notifications.js';
import {
  ROUTES as AU_ROUTES,
  handleAdminUsers,
} from '../server/routes/api/admin-users.js';
import {
  ROUTES as AI_ROUTES,
  handleAdminAiLogs,
} from '../server/routes/api/admin-ai-logs.js';
import {
  ROUTES as CST_ROUTES,
  handleCustomSlideTypes,
} from '../server/routes/api/custom-slide-types.js';
import {
  ROUTES as ET_ROUTES,
  handleEmailTemplates,
} from '../server/routes/api/email-templates.js';
import {
  ROUTES as LSA_ROUTES,
  handleLiveSessionsPublic,
} from '../server/routes/api/live-session-audience.js';

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
  assert.equal(
    route.handler.name,
    handlerName,
    `${method} ${path} → ${handlerName}`,
  );
}

// ─── slide-collections (module prefix + auth guard; Form B per path group) ───

test('slide-collections: routes resolve to their named handlers in order', () => {
  named(
    SC_ROUTES,
    'GET',
    '/api/slide-collections/personal',
    'handlePersonalList',
  );
  named(
    SC_ROUTES,
    'POST',
    '/api/slide-collections/personal',
    'handlePersonalCreate',
  );
  named(
    SC_ROUTES,
    'GET',
    '/api/slide-collections/personal/abc',
    'handlePersonalGet',
  );
  named(
    SC_ROUTES,
    'PATCH',
    '/api/slide-collections/personal/abc',
    'handlePersonalUpdate',
  );
  named(
    SC_ROUTES,
    'DELETE',
    '/api/slide-collections/personal/abc',
    'handlePersonalDelete',
  );
  named(
    SC_ROUTES,
    'GET',
    '/api/slide-collections/organization',
    'handleOrganizationList',
  );
  named(
    SC_ROUTES,
    'POST',
    '/api/slide-collections/organization',
    'handleOrganizationCreate',
  );
  named(
    SC_ROUTES,
    'GET',
    '/api/slide-collections/organization/abc',
    'handleOrganizationGet',
  );
  named(
    SC_ROUTES,
    'PATCH',
    '/api/slide-collections/organization/abc',
    'handleOrganizationUpdate',
  );
  named(
    SC_ROUTES,
    'DELETE',
    '/api/slide-collections/organization/abc',
    'handleOrganizationDelete',
  );
});

test('slide-collections: a wrong method 405s with the pinned Allow list', async () => {
  for (const [method, path, allow] of [
    ['DELETE', '/api/slide-collections/personal', 'GET, POST'],
    ['POST', '/api/slide-collections/personal/abc', 'GET, PATCH, DELETE'],
    ['DELETE', '/api/slide-collections/organization', 'GET, POST'],
    ['POST', '/api/slide-collections/organization/abc', 'GET, PATCH, DELETE'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleSlideCollections(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(
      res.headers.Allow,
      allow,
      `${method} ${path} → Allow: ${allow}`,
    );
  }
});

test('slide-collections: module guards — foreign prefix falls through, unauth 401s', async () => {
  const foreign = ctx('GET', '/api/not-slide-collections');
  assert.equal(await handleSlideCollections(foreign.ctx), false);

  const unauth = ctx('GET', '/api/slide-collections/personal', null);
  await handleSlideCollections(unauth.ctx);
  assert.equal(
    unauth.res.statusCode,
    401,
    'no user → 401 for any slide-collections path',
  );
});

test('slide-collections: an unknown sub-path falls through (authed)', async () => {
  const { ctx: c } = ctx('GET', '/api/slide-collections/nope/deep/path');
  assert.equal(await handleSlideCollections(c), false);
});

// ─── organizations (module prefix + feature flag + auth guards; all Form A) ───

test('organizations: routes resolve to their named handlers', () => {
  named(ORG_ROUTES, 'GET', '/api/organizations', 'handleOrgList');
  named(ORG_ROUTES, 'POST', '/api/organizations', 'handleOrgCreate');
  named(ORG_ROUTES, 'GET', '/api/organizations/org-1', 'handleOrgGet');
  named(ORG_ROUTES, 'PATCH', '/api/organizations/org-1', 'handleOrgUpdate');
  named(ORG_ROUTES, 'DELETE', '/api/organizations/org-1', 'handleOrgDelete');
  named(
    ORG_ROUTES,
    'POST',
    '/api/organizations/org-1/switch',
    'handleOrgSwitch',
  );
});

test('organizations: a wrong method falls through in the table (Form A)', () => {
  assert.equal(select(ORG_ROUTES, 'PUT', '/api/organizations'), null);
  assert.equal(select(ORG_ROUTES, 'POST', '/api/organizations/org-1'), null);
  assert.equal(
    select(ORG_ROUTES, 'GET', '/api/organizations/org-1/switch'),
    null,
  );
});

test('organizations: module guards — foreign prefix falls through, feature flag 403s', async () => {
  const foreign = ctx('GET', '/api/not-organizations');
  assert.equal(await handleOrganizations(foreign.ctx), false);

  // MULTI_ORG is not enabled in the test environment, so the flag guard
  // answers 403 before auth or storage is consulted.
  const flagged = ctx('GET', '/api/organizations');
  await handleOrganizations(flagged.ctx);
  assert.equal(
    flagged.res.statusCode,
    403,
    'flag disabled → 403 for any organizations path',
  );
});

// ─── notifications (module auth guard falls through, not 401; all Form A) ───

test('notifications: routes resolve to their named handlers in order', () => {
  named(
    NOTIF_ROUTES,
    'GET',
    '/api/notifications/events',
    'handleNotificationEvents',
  );
  named(
    NOTIF_ROUTES,
    'GET',
    '/api/notifications/unread-count',
    'handleNotificationUnreadCount',
  );
  named(
    NOTIF_ROUTES,
    'POST',
    '/api/notifications/mark-read',
    'handleNotificationMarkRead',
  );
  named(
    NOTIF_ROUTES,
    'POST',
    '/api/notifications/archive',
    'handleNotificationArchive',
  );
  named(NOTIF_ROUTES, 'GET', '/api/notifications', 'handleNotificationList');
});

test('notifications: a wrong method falls through (Form A), and unauth falls through too', async () => {
  const wrongMethod = ctx('POST', '/api/notifications');
  assert.equal(await handleNotifications(wrongMethod.ctx), false);

  const alsoWrong = ctx('GET', '/api/notifications/mark-read');
  assert.equal(await handleNotifications(alsoWrong.ctx), false);

  // The original guard returned false (not a 401) without a user — the root
  // dispatcher's 404 answers. Pinned so the migration cannot change it.
  const unauth = ctx('GET', '/api/notifications', null);
  assert.equal(await handleNotifications(unauth.ctx), false);
  assert.equal(unauth.res.statusCode, null, 'no status written for unauth');
});

// ─── admin-users (module prefix + auth + admin guards; all Form A) ───

const admin = { email: 'admin@b.test', isAdmin: true };

test('admin-users: routes resolve to their named handlers', () => {
  named(AU_ROUTES, 'GET', '/api/admin/users', 'handleAdminUserList');
  named(AU_ROUTES, 'POST', '/api/admin/users', 'handleAdminUserCreate');
  named(AU_ROUTES, 'GET', '/api/admin/users/u-1', 'handleAdminUserGet');
  named(AU_ROUTES, 'PATCH', '/api/admin/users/u-1', 'handleAdminUserUpdate');
  named(AU_ROUTES, 'DELETE', '/api/admin/users/u-1', 'handleAdminUserDelete');
  named(
    AU_ROUTES,
    'POST',
    '/api/admin/users/u-1/resend-invitation',
    'handleAdminUserResendInvitation',
  );
});

test('admin-users: module guards — foreign prefix falls through, non-admin 403s', async () => {
  const foreign = ctx('GET', '/api/admin/other');
  assert.equal(await handleAdminUsers(foreign.ctx), false);

  const unauth = ctx('GET', '/api/admin/users', null);
  await handleAdminUsers(unauth.ctx);
  assert.equal(unauth.res.statusCode, 401, 'no user → 401');

  const nonAdmin = ctx('GET', '/api/admin/users');
  await handleAdminUsers(nonAdmin.ctx);
  assert.equal(nonAdmin.res.statusCode, 403, 'non-admin → 403');
});

test('admin-users: a wrong method falls through (Form A, admin)', async () => {
  assert.equal(select(AU_ROUTES, 'PUT', '/api/admin/users'), null);
  const { ctx: c } = ctx('PUT', '/api/admin/users', admin);
  assert.equal(await handleAdminUsers(c), false);
});

// ─── admin-ai-logs (module prefix + auth + admin guards; all Form A) ───

test('admin-ai-logs: routes resolve to their named handlers', () => {
  named(AI_ROUTES, 'GET', '/api/admin/ai-logs', 'handleAiLogsList');
  named(AI_ROUTES, 'GET', '/api/admin/ai-logs/summary', 'handleAiLogsSummary');
  named(AI_ROUTES, 'GET', '/api/admin/ai-logs/entries', 'handleAiLogsEntries');
  named(
    AI_ROUTES,
    'GET',
    '/api/admin/ai-logs/download/some-file.ndjson',
    'handleAiLogsDownload',
  );
  named(AI_ROUTES, 'POST', '/api/admin/ai-logs/cleanup', 'handleAiLogsCleanup');
});

test('admin-ai-logs: module guards and Form A fall-through', async () => {
  const foreign = ctx('GET', '/api/admin/users');
  assert.equal(await handleAdminAiLogs(foreign.ctx), false);

  const nonAdmin = ctx('GET', '/api/admin/ai-logs');
  await handleAdminAiLogs(nonAdmin.ctx);
  assert.equal(nonAdmin.res.statusCode, 403, 'non-admin → 403');

  assert.equal(select(AI_ROUTES, 'POST', '/api/admin/ai-logs'), null);
  const wrongMethod = ctx('POST', '/api/admin/ai-logs', admin);
  assert.equal(await handleAdminAiLogs(wrongMethod.ctx), false);
});

// ─── custom-slide-types (no module guard, per-route guards; Form B + one Form A) ───

test('custom-slide-types: routes resolve to their named handlers in order', () => {
  named(
    CST_ROUTES,
    'GET',
    '/api/custom-slide-types',
    'handleCustomSlideTypeList',
  );
  named(
    CST_ROUTES,
    'POST',
    '/api/custom-slide-types',
    'handleCustomSlideTypeCreate',
  );
  named(
    CST_ROUTES,
    'PUT',
    '/api/custom-slide-types/reorder',
    'handleCustomSlideTypeReorder',
  );
  named(
    CST_ROUTES,
    'POST',
    '/api/custom-slide-types/abc123/duplicate',
    'handleCustomSlideTypeDuplicate',
  );
  named(
    CST_ROUTES,
    'GET',
    '/api/custom-slide-types/abc123',
    'handleCustomSlideTypeGet',
  );
  named(
    CST_ROUTES,
    'PUT',
    '/api/custom-slide-types/abc123',
    'handleCustomSlideTypeUpdate',
  );
  named(
    CST_ROUTES,
    'DELETE',
    '/api/custom-slide-types/abc123',
    'handleCustomSlideTypeDelete',
  );
});

test('custom-slide-types: a wrong method 405s with the pinned Allow list', async () => {
  for (const [method, path, allow] of [
    ['DELETE', '/api/custom-slide-types', 'GET, POST'],
    ['POST', '/api/custom-slide-types/reorder', 'PUT'],
    ['PATCH', '/api/custom-slide-types/abc123', 'GET, PUT, DELETE'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleCustomSlideTypes(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(
      res.headers.Allow,
      allow,
      `${method} ${path} → Allow: ${allow}`,
    );
  }
});

test('custom-slide-types: /reorder keeps method-before-guard (405 beats 403), designer guard still 403s on PUT', async () => {
  // Wrong method by a non-designer: the original checked the method first.
  const wrongMethod = ctx('POST', '/api/custom-slide-types/reorder');
  await handleCustomSlideTypes(wrongMethod.ctx);
  assert.equal(wrongMethod.res.statusCode, 405, 'wrong method → 405, not 403');

  // Right method without the designer capability: 403 before any storage call.
  const nonDesigner = ctx('PUT', '/api/custom-slide-types/reorder');
  await handleCustomSlideTypes(nonDesigner.ctx);
  assert.equal(nonDesigner.res.statusCode, 403, 'PUT without canManage → 403');
});

test('custom-slide-types: /duplicate falls through on a wrong method (Form A)', async () => {
  assert.equal(
    select(CST_ROUTES, 'GET', '/api/custom-slide-types/abc123/duplicate'),
    null,
  );
  const { ctx: c } = ctx('GET', '/api/custom-slide-types/abc123/duplicate');
  assert.equal(await handleCustomSlideTypes(c), false);
});

// ─── email-templates (module prefix + auth + admin guards; all Form A) ───

test('email-templates: routes resolve to their named handlers in order', () => {
  named(
    ET_ROUTES,
    'GET',
    '/api/admin/email-templates',
    'handleEmailTemplateList',
  );
  named(
    ET_ROUTES,
    'GET',
    '/api/admin/email-templates/metadata',
    'handleEmailTemplateMetadata',
  );
  named(
    ET_ROUTES,
    'PUT',
    '/api/admin/email-templates/settings',
    'handleEmailTemplateSettings',
  );
  named(
    ET_ROUTES,
    'PUT',
    '/api/admin/email-templates/welcome/nl',
    'handleEmailTemplateWrite',
  );
  named(
    ET_ROUTES,
    'DELETE',
    '/api/admin/email-templates/welcome/nl',
    'handleEmailTemplateReset',
  );
  named(
    ET_ROUTES,
    'POST',
    '/api/admin/email-templates/welcome/preview',
    'handleEmailTemplatePreview',
  );
  named(
    ET_ROUTES,
    'POST',
    '/api/admin/email-templates/welcome/test',
    'handleEmailTemplateTest',
  );
});

test('email-templates: the :type/:locale PUT row still shadows /preview for PUTs (first-match order)', () => {
  // PUT …/x/preview resolved as a template write (invalid locale → 400)
  // before the migration; the row order preserves that.
  named(
    ET_ROUTES,
    'PUT',
    '/api/admin/email-templates/welcome/preview',
    'handleEmailTemplateWrite',
  );
});

test('email-templates: module guards and Form A fall-through', async () => {
  const foreign = ctx('GET', '/api/admin/ai-logs');
  assert.equal(await handleEmailTemplates(foreign.ctx), false);

  const nonAdmin = ctx('GET', '/api/admin/email-templates');
  await handleEmailTemplates(nonAdmin.ctx);
  assert.equal(nonAdmin.res.statusCode, 403, 'non-admin → 403');

  assert.equal(select(ET_ROUTES, 'DELETE', '/api/admin/email-templates'), null);
  const wrongMethod = ctx('DELETE', '/api/admin/email-templates', admin);
  assert.equal(await handleEmailTemplates(wrongMethod.ctx), false);
});

// ─── live-session-audience (public block; Form A state/events, Form B deck/notes) ───

test('live-session-audience: routes resolve to their named handlers', () => {
  named(
    LSA_ROUTES,
    'GET',
    '/api/live-sessions/s-1/state',
    'handleSessionState',
  );
  named(
    LSA_ROUTES,
    'GET',
    '/api/live-sessions/s-1/events',
    'handleSessionEvents',
  );
  named(LSA_ROUTES, 'GET', '/api/live-sessions/s-1/deck', 'handleSessionDeck');
  named(
    LSA_ROUTES,
    'PUT',
    '/api/live-sessions/s-1/notes/slide-1',
    'handleSessionNotesWrite',
  );
});

test('live-session-audience: /state and /events fall through on a wrong method (Form A, on purpose)', async () => {
  // Their POST counterparts are presenter actions behind the login gate in
  // live-sessions.js — a 405 here would shadow them.
  assert.equal(
    select(LSA_ROUTES, 'POST', '/api/live-sessions/s-1/state'),
    null,
  );
  assert.equal(
    select(LSA_ROUTES, 'POST', '/api/live-sessions/s-1/events'),
    null,
  );
  const { ctx: c } = ctx('POST', '/api/live-sessions/s-1/state', null);
  assert.equal(await handleLiveSessionsPublic(c), false);
});

test('live-session-audience: /deck and /notes keep their explicit 405', async () => {
  for (const [method, path, allow] of [
    ['POST', '/api/live-sessions/s-1/deck', 'GET'],
    ['GET', '/api/live-sessions/s-1/notes/slide-1', 'PUT'],
  ]) {
    const { ctx: c, res } = ctx(method, path, null);
    await handleLiveSessionsPublic(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(
      res.headers.Allow,
      allow,
      `${method} ${path} → Allow: ${allow}`,
    );
  }
});

test('live-session-audience: an unknown sub-path falls through', async () => {
  const { ctx: c } = ctx('GET', '/api/live-sessions/s-1/unknown', null);
  assert.equal(await handleLiveSessionsPublic(c), false);
});
