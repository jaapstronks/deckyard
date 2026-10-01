/**
 * A7.19 C8 fase 2 — notion family route-table migration.
 *
 * The notion module (docs/reference/route-dispatch.md) is Form A throughout:
 * every route is method-bearing and a method mismatch falls through (the old
 * per-file `pathname !== X || method !== Y` guards had no 405). One table
 * (B522): whether the module exists is its mount's `feature: 'notion'`
 * (`NOTION_ENABLED`, pinned in tests/ai-kill-switch.test.js); each handler
 * self-gates on `notionEnabled()` (configured); the two import rows also carry
 * `feature: 'ai'`.
 *
 * Routing is asserted with `select()` over the exported tables (storage-free);
 * fall-through is asserted by invoking `handleNotion` for a wrong method and an
 * unknown path — neither reaches a real handler. `GET /api/notion/status` is
 * the one storage-free handler, so it is invoked end-to-end.
 *
 * Run with: node --test tests/route-dispatch-notion.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES, handleNotion } from '../server/routes/api/notion/index.js';

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

function ctx(method, pathname) {
  const res = mockRes();
  return {
    res,
    ctx: {
      repoRoot: '/tmp',
      storageScope: {},
      authedUser: { email: 'a@b.test' },
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

test('notion: one table, every route resolves to its named handler in order', () => {
  named(ROUTES, 'GET', '/api/notion/status', 'handleNotionStatus');
  named(ROUTES, 'POST', '/api/notion/fetch', 'handleNotionFetch');
  named(ROUTES, 'POST', '/api/notion/publish', 'handleNotionPublish');
  named(ROUTES, 'POST', '/api/notion/import', 'handleNotionImport');
  named(
    ROUTES,
    'POST',
    '/api/notion/import/stream',
    'handleNotionImportStream',
  );
  named(ROUTES, 'POST', '/api/notion/subjects', 'handleNotionSubjects');
  named(ROUTES, 'POST', '/api/notion/compose', 'handleNotionCompose');
  named(ROUTES, 'POST', '/api/notion/suggest', 'handleNotionSuggest');
  assert.equal(ROUTES.length, 8, 'eight rows, all behind the notion mount');
});

test('notion: exactly the two import rows spend AI tokens', () => {
  assert.deepEqual(
    ROUTES.filter((r) => r.feature).map((r) => [r.pattern, r.feature]),
    [
      ['/api/notion/import', 'ai'],
      ['/api/notion/import/stream', 'ai'],
    ],
  );
});

test('notion: import/stream stay distinct — /import does not swallow /import/stream', () => {
  named(ROUTES, 'POST', '/api/notion/import', 'handleNotionImport');
  named(
    ROUTES,
    'POST',
    '/api/notion/import/stream',
    'handleNotionImportStream',
  );
});

test('notion: a wrong method on a path falls through (no 405)', async () => {
  // GET on a POST-only path matches no row and never reaches a
  // storage-touching handler.
  for (const path of [
    '/api/notion/fetch',
    '/api/notion/import',
    '/api/notion/import/stream',
  ]) {
    const { ctx: c, res } = ctx('GET', path);
    assert.equal(await handleNotion(c), false, `GET ${path} → false`);
    assert.equal(res.statusCode, null, `GET ${path} sent no response`);
  }
});

test('notion: an unknown sub-path falls through', async () => {
  const { ctx: c } = ctx('POST', '/api/notion/unknown');
  assert.equal(await handleNotion(c), false);

  const foreign = ctx('GET', '/api/notionesque');
  assert.equal(await handleNotion(foreign.ctx), false);
});

test('notion: GET /api/notion/status dispatches to the status handler (storage-free)', async () => {
  const { ctx: c, res } = ctx('GET', '/api/notion/status');
  assert.equal(await handleNotion(c), true);
  assert.equal(res.statusCode, 200, 'status endpoint answers 200');
});

test('notion: the dispatcher forwards storageScope to the import handler (B62 vondst 2 regression)', async () => {
  // Before the ROUTES-table migration (#686) the notion dispatcher hand-built a
  // partial ctx `{ req, res, url, authedUser, repoRoot }` and dropped
  // `storageScope`, so `createPresentation(undefined, …)` threw the scope
  // TypeError and every import 500'd. dispatchRoutes forwards the whole ctx;
  // pin that the import handler still receives the exact scope the auth gate
  // put on ctx, so a future hand-rolled ctx cannot silently drop it again.
  const importRoute = ROUTES.find((r) => r.pattern === '/api/notion/import');
  assert.ok(importRoute, 'the import route is present');
  const realHandler = importRoute.handler;
  let seen = null;
  importRoute.handler = (received) => {
    seen = received;
    return true;
  };
  try {
    const scope = { organizationId: 'org-sentinel', actorEmail: 'a@b.test' };
    const { ctx: c } = ctx('POST', '/api/notion/import');
    c.storageScope = scope;
    assert.equal(await handleNotion(c), true);
    assert.ok(seen, 'the import handler was invoked');
    assert.equal(
      seen.storageScope,
      scope,
      'the exact storageScope reached the handler',
    );
  } finally {
    importRoute.handler = realHandler;
  }
});
