/**
 * A7.19 C8 fase 2 — batch 6 route-table migration.
 *
 * Seven modules (docs/reference/route-dispatch.md): `media` and
 * `slide-library` are Form B throughout (explicit 405s per path group);
 * `uploads`, `sandbox`, `bulk-export` and the `export` PNG-slide row are
 * single method-bearing rows that fall through (Form A);
 * `organization-members` keeps its guards-before-method shape as two single
 * no-method handlers.
 *
 * Routing is asserted with `select()` over the exported ROUTES (storage-free);
 * 405/401/403 behaviour is asserted by invoking the entry function — which for
 * a wrong method or failing guard never reaches a real storage handler.
 *
 * Run with: node --test tests/c8-routes-batch-6-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTES as MEDIA_ROUTES,
  handleMedia,
} from '../server/routes/api/media.js';
import {
  ROUTES as SL_ROUTES,
  handleSlideLibrary,
} from '../server/routes/api/slide-library.js';
import {
  ROUTES as UP_ROUTES,
  handleUploads,
} from '../server/routes/api/uploads.js';
import {
  ROUTES as SB_ROUTES,
  handleSandbox,
} from '../server/routes/api/sandbox.js';
import {
  ROUTES as OM_ROUTES,
  handleOrganizationMembers,
} from '../server/routes/api/organization-members.js';
import { ROUTES as EX_ROUTES } from '../server/routes/api/export.js';
import {
  ROUTES as BE_ROUTES,
  handleBulkExport,
} from '../server/routes/api/bulk-export.js';

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

// ─── media (prefix guard; Form B throughout) ───

test('media: routes resolve to their named handlers in order', () => {
  named(MEDIA_ROUTES, 'GET', '/api/media/status', 'handleMediaStatus');
  named(MEDIA_ROUTES, 'POST', '/api/media/presign', 'handleMediaPresign');
  named(MEDIA_ROUTES, 'POST', '/api/media/confirm', 'handleMediaConfirm');
  named(
    MEDIA_ROUTES,
    'GET',
    '/api/media/imagekit/status',
    'handleImageKitStatus',
  );
  named(
    MEDIA_ROUTES,
    'GET',
    '/api/media/imagekit/files',
    'handleImageKitFiles',
  );
  named(
    MEDIA_ROUTES,
    'GET',
    '/api/media/imagekit/tags',
    'handleImageKitTagList',
  );
  named(
    MEDIA_ROUTES,
    'GET',
    '/api/media/imagekit/files/f-1/details',
    'handleImageKitDetailsGet',
  );
  named(
    MEDIA_ROUTES,
    'PATCH',
    '/api/media/imagekit/files/f-1/details',
    'handleImageKitDetailsPatch',
  );
});

test('media: a wrong method 405s with the pinned Allow list', async () => {
  for (const [method, path, allow] of [
    ['POST', '/api/media/status', 'GET'],
    ['GET', '/api/media/presign', 'POST'],
    ['GET', '/api/media/confirm', 'POST'],
    ['POST', '/api/media/imagekit/status', 'GET'],
    ['POST', '/api/media/imagekit/files', 'GET'],
    ['POST', '/api/media/imagekit/tags', 'GET'],
    ['DELETE', '/api/media/imagekit/files/f-1/details', 'GET, PATCH'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleMedia(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(
      res.headers.Allow,
      allow,
      `${method} ${path} → Allow: ${allow}`,
    );
  }
});

test('media: module prefix guard falls through, presign auth 401s after the method match', async () => {
  const foreign = ctx('GET', '/api/medianot');
  assert.equal(await handleMedia(foreign.ctx), false);

  const unauth = ctx('POST', '/api/media/presign', null);
  await handleMedia(unauth.ctx);
  assert.equal(
    unauth.res.statusCode,
    401,
    'unauth presign → 401 (method matched first)',
  );
});

// ─── slide-library (prefix + auth guard; Form B per path group) ───

test('slide-library: routes resolve to their named handlers in order', () => {
  named(SL_ROUTES, 'GET', '/api/slide-library/usage', 'handleUsageList');
  named(SL_ROUTES, 'POST', '/api/slide-library/usage', 'handleUsageRecord');
  named(SL_ROUTES, 'GET', '/api/slide-library/personal', 'handlePersonalList');
  named(
    SL_ROUTES,
    'POST',
    '/api/slide-library/personal',
    'handlePersonalCreate',
  );
  named(
    SL_ROUTES,
    'PATCH',
    '/api/slide-library/personal/i-1',
    'handlePersonalUpdate',
  );
  named(
    SL_ROUTES,
    'DELETE',
    '/api/slide-library/personal/i-1',
    'handlePersonalDelete',
  );
  named(
    SL_ROUTES,
    'GET',
    '/api/slide-library/organization',
    'handleOrganizationList',
  );
  named(
    SL_ROUTES,
    'POST',
    '/api/slide-library/organization',
    'handleOrganizationCreate',
  );
  named(
    SL_ROUTES,
    'PATCH',
    '/api/slide-library/organization/i-1',
    'handleOrganizationUpdate',
  );
  named(
    SL_ROUTES,
    'DELETE',
    '/api/slide-library/organization/i-1',
    'handleOrganizationDelete',
  );
  named(
    SL_ROUTES,
    'GET',
    '/api/slide-library/personal/i-1/tags',
    'handleItemTagsGet',
  );
  named(
    SL_ROUTES,
    'PUT',
    '/api/slide-library/personal/i-1/tags',
    'handleItemTagsPut',
  );
  named(
    SL_ROUTES,
    'GET',
    '/api/slide-library/organization/i-1/tags',
    'handleItemTagsGet',
  );
  named(
    SL_ROUTES,
    'PUT',
    '/api/slide-library/organization/i-1/tags',
    'handleItemTagsPut',
  );
});

test('slide-library: a wrong method 405s with the pinned Allow list', async () => {
  for (const [method, path, allow] of [
    // The /usage catch-all used to crash (methodNotAllowed without an Allow
    // list → 500); it now carries the list its two rows imply.
    ['DELETE', '/api/slide-library/usage', 'GET, POST'],
    ['DELETE', '/api/slide-library/personal', 'GET, POST'],
    ['GET', '/api/slide-library/personal/i-1', 'PATCH, DELETE'],
    ['DELETE', '/api/slide-library/organization', 'GET, POST'],
    ['GET', '/api/slide-library/organization/i-1', 'PATCH, DELETE'],
    ['POST', '/api/slide-library/personal/i-1/tags', 'GET, PUT'],
    ['POST', '/api/slide-library/organization/i-1/tags', 'GET, PUT'],
  ]) {
    const { ctx: c, res } = ctx(method, path);
    await handleSlideLibrary(c);
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(
      res.headers.Allow,
      allow,
      `${method} ${path} → Allow: ${allow}`,
    );
  }
});

test('slide-library: module guards — foreign prefix falls through, unauth 401s', async () => {
  const foreign = ctx('GET', '/api/slide-collections');
  assert.equal(await handleSlideLibrary(foreign.ctx), false);

  const unauth = ctx('GET', '/api/slide-library/personal', null);
  await handleSlideLibrary(unauth.ctx);
  assert.equal(
    unauth.res.statusCode,
    401,
    'no user → 401 for any slide-library path',
  );
});

// ─── uploads (one POST-only row, Form A) ───

test('uploads: POST resolves, other methods fall through, unauth 401s', async () => {
  named(UP_ROUTES, 'POST', '/api/uploads', 'handleUploadCreate');
  assert.equal(select(UP_ROUTES, 'GET', '/api/uploads'), null);

  const wrongMethod = ctx('GET', '/api/uploads');
  assert.equal(await handleUploads(wrongMethod.ctx), false);

  const unauth = ctx('POST', '/api/uploads', null);
  await handleUploads(unauth.ctx);
  assert.equal(unauth.res.statusCode, 401, 'unauth upload → 401');
});

// ─── sandbox (one GET-only row, Form A; 404 outside sandbox mode) ───

test('sandbox: GET resolves, other methods fall through, disabled mode 404s', async () => {
  named(SB_ROUTES, 'GET', '/api/sandbox/examples', 'handleSandboxExamples');
  assert.equal(select(SB_ROUTES, 'POST', '/api/sandbox/examples'), null);

  const wrongMethod = ctx('POST', '/api/sandbox/examples');
  assert.equal(await handleSandbox(wrongMethod.ctx), false);

  // Sandbox mode is off in the test environment: the endpoint answers 404, so
  // it simply doesn't exist on a normal install.
  const disabled = ctx('GET', '/api/sandbox/examples');
  await handleSandbox(disabled.ctx);
  assert.equal(disabled.res.statusCode, 404);
});

// ─── organization-members (guards-before-method single handlers) ───

test('organization-members: both member shapes resolve with their captures', () => {
  const collection = select(
    OM_ROUTES,
    'GET',
    '/api/organizations/org-1/members',
  );
  assert.equal(collection?.handler.name, 'handleMembersCollection');
  assert.deepEqual(
    collection.pattern.exec('/api/organizations/org-1/members').slice(1),
    ['org-1'],
  );

  const item = select(
    OM_ROUTES,
    'DELETE',
    '/api/organizations/org-1/members/m-1',
  );
  assert.equal(item?.handler.name, 'handleMemberItem');
  assert.deepEqual(
    item.pattern.exec('/api/organizations/org-1/members/m-1').slice(1),
    ['org-1', 'm-1'],
  );
});

test('organization-members: a non-members organizations path falls through untouched', async () => {
  // The old combined shape regex only claimed .../members(/...)?; a plain
  // /api/organizations/:id request must keep falling through with no 403
  // flag-guard leak.
  const { ctx: c, res } = ctx('PUT', '/api/organizations/org-1');
  assert.equal(await handleOrganizationMembers(c), false);
  assert.equal(res.statusCode, null, 'no guard ran for a non-members path');
});

test('organization-members: the flag guard answers 403 before the method decision', async () => {
  // MULTI_ORG is not enabled in the test environment; any method on a members
  // path gets the 403, exactly as the original guards-before-method chain did.
  for (const method of ['GET', 'PUT']) {
    const { ctx: c, res } = ctx(method, '/api/organizations/org-1/members');
    await handleOrganizationMembers(c);
    assert.equal(res.statusCode, 403, `${method} members with flag off → 403`);
  }
});

// ─── export (PNG-slide row before the factory-built routes) ───

test('export: the PNG-slide row resolves with both captures, GET-only', () => {
  const route = select(
    EX_ROUTES,
    'GET',
    '/api/presentations/p-1/export/png/3.png',
  );
  assert.equal(route?.handler.name, 'handlePngSlideExport');
  assert.deepEqual(
    route.pattern.exec('/api/presentations/p-1/export/png/3.png').slice(1),
    ['p-1', '3'],
  );
  assert.equal(
    select(EX_ROUTES, 'POST', '/api/presentations/p-1/export/png/3.png'),
    null,
  );
});

// ─── bulk-export (two method-bearing rows, Form A) ───

test('bulk-export: routes resolve, wrong methods fall through, unauth 401s', async () => {
  named(BE_ROUTES, 'GET', '/api/bulk-export/status', 'handleBulkExportStatus');
  named(BE_ROUTES, 'POST', '/api/bulk-export', 'handleBulkExportStart');
  assert.equal(select(BE_ROUTES, 'GET', '/api/bulk-export'), null);
  assert.equal(select(BE_ROUTES, 'POST', '/api/bulk-export/status'), null);

  const wrongMethod = ctx('GET', '/api/bulk-export');
  assert.equal(await handleBulkExport(wrongMethod.ctx), false);

  const unauthStatus = ctx('GET', '/api/bulk-export/status', null);
  await handleBulkExport(unauthStatus.ctx);
  assert.equal(unauthStatus.res.statusCode, 401);

  const unauthStart = ctx('POST', '/api/bulk-export', null);
  await handleBulkExport(unauthStart.ctx);
  assert.equal(unauthStart.res.statusCode, 401);
});
