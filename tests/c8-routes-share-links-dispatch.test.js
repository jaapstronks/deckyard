/**
 * A7.19 C8 fase 2 — share-links family route-table migration.
 *
 * The share-links module (docs/reference/route-dispatch.md) is Form A
 * throughout: every route is method-bearing and a method mismatch falls
 * through (the old per-file `match && method === X` branches had no 405).
 * Two tables mirror the two mounts in `routes/api/index.js`:
 * `AUTHED_ROUTES` (management + guest management, behind the auth gate) and
 * `PUBLIC_ROUTES` (the anonymous `/api/share/:token` surface, before it).
 *
 * Routing is asserted with `select()` over the exported tables
 * (storage-free); regex captures are asserted directly on the patterns so a
 * reordered or reworded capture group cannot silently shift handler
 * arguments. Fall-through is asserted by invoking the entry functions with a
 * wrong method and an unknown path — neither reaches a real handler.
 *
 * Run with: node --test tests/c8-routes-share-links-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTHED_ROUTES,
  PUBLIC_ROUTES,
  handleShareLinks,
  handleSharePublic,
} from '../server/routes/api/share-links.js';

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

/** Assert what a route's pattern captures for a concrete path. */
function captures(routes, method, path, expected) {
  const route = select(routes, method, path);
  assert.ok(route, `${method} ${path} matches a route`);
  const match = route.pattern.exec(path);
  assert.deepEqual(
    match.slice(1),
    expected,
    `${method} ${path} captures ${expected.join(', ')}`,
  );
}

test('share-links: management routes resolve to their named handlers in order', () => {
  named(
    AUTHED_ROUTES,
    'POST',
    '/api/presentations/p1/share-links',
    'handleShareLinkCreate',
  );
  named(
    AUTHED_ROUTES,
    'GET',
    '/api/presentations/p1/share-links',
    'handleShareLinkList',
  );
  named(
    AUTHED_ROUTES,
    'DELETE',
    '/api/presentations/p1/share-links',
    'handleShareLinksRevokeAll',
  );
  named(
    AUTHED_ROUTES,
    'DELETE',
    '/api/presentations/p1/share-links/l1',
    'handleShareLinkRevoke',
  );
  named(
    AUTHED_ROUTES,
    'PATCH',
    '/api/presentations/p1/share-links/l1',
    'handleShareLinkUpdate',
  );
  named(
    AUTHED_ROUTES,
    'GET',
    '/api/presentations/p1/share-links/l1/access-log',
    'handleShareLinkAccessLog',
  );
});

test('share-links: guest management routes resolve to their named handlers in order', () => {
  named(
    AUTHED_ROUTES,
    'POST',
    '/api/presentations/p1/share-links/l1/guests',
    'handleGuestPreRegister',
  );
  named(
    AUTHED_ROUTES,
    'GET',
    '/api/presentations/p1/share-links/l1/guests',
    'handleGuestList',
  );
  named(
    AUTHED_ROUTES,
    'DELETE',
    '/api/presentations/p1/share-links/l1/guests/g1',
    'handleGuestRemove',
  );
  named(
    AUTHED_ROUTES,
    'POST',
    '/api/presentations/p1/share-links/l1/guests/g1/resend',
    'handleGuestResend',
  );
});

test('share-links: public routes resolve to their named handlers in order', () => {
  named(PUBLIC_ROUTES, 'GET', '/api/share/tok', 'handleShareValidate');
  named(PUBLIC_ROUTES, 'POST', '/api/share/tok/verify', 'handleShareVerify');
  named(
    PUBLIC_ROUTES,
    'POST',
    '/api/share/tok/guest/request',
    'handleShareGuestRequest',
  );
  named(
    PUBLIC_ROUTES,
    'GET',
    '/api/share/tok/guest/verify/vtok',
    'handleShareGuestVerify',
  );
  named(PUBLIC_ROUTES, 'GET', '/api/share/tok/guest/me', 'handleShareGuestMe');
});

test('share-links: patterns capture ids in handler-argument order', () => {
  captures(AUTHED_ROUTES, 'POST', '/api/presentations/p1/share-links', ['p1']);
  captures(AUTHED_ROUTES, 'PATCH', '/api/presentations/p1/share-links/l1', [
    'p1',
    'l1',
  ]);
  captures(
    AUTHED_ROUTES,
    'GET',
    '/api/presentations/p1/share-links/l1/access-log',
    ['p1', 'l1'],
  );
  captures(
    AUTHED_ROUTES,
    'POST',
    '/api/presentations/p1/share-links/l1/guests',
    ['p1', 'l1'],
  );
  captures(
    AUTHED_ROUTES,
    'DELETE',
    '/api/presentations/p1/share-links/l1/guests/g1',
    ['p1', 'l1', 'g1'],
  );
  captures(
    AUTHED_ROUTES,
    'POST',
    '/api/presentations/p1/share-links/l1/guests/g1/resend',
    ['p1', 'l1', 'g1'],
  );
  captures(PUBLIC_ROUTES, 'GET', '/api/share/tok', ['tok']);
  captures(PUBLIC_ROUTES, 'GET', '/api/share/tok/guest/verify/vtok', [
    'tok',
    'vtok',
  ]);
});

test('share-links: sibling patterns stay distinct — no pattern swallows a deeper path', () => {
  // The :linkId pattern must not claim /guests, /access-log or /resend paths,
  // and the base /api/share/:token must not claim the /verify and /guest/*
  // sub-paths.
  assert.equal(
    select(
      AUTHED_ROUTES,
      'DELETE',
      '/api/presentations/p1/share-links/l1/guests/g1',
    ).handler.name,
    'handleGuestRemove',
  );
  assert.equal(
    select(PUBLIC_ROUTES, 'GET', '/api/share/tok/guest/me').handler.name,
    'handleShareGuestMe',
  );
});

test('share-links: a wrong method falls through (no 405, storage-free)', async () => {
  const cases = [
    ['PATCH', '/api/presentations/p1/share-links'],
    ['GET', '/api/presentations/p1/share-links/l1'],
    ['POST', '/api/presentations/p1/share-links/l1/access-log'],
    ['PATCH', '/api/presentations/p1/share-links/l1/guests'],
    ['GET', '/api/presentations/p1/share-links/l1/guests/g1/resend'],
  ];
  for (const [method, path] of cases) {
    const { ctx: c, res } = ctx(method, path);
    assert.equal(await handleShareLinks(c), false, `${method} ${path} → false`);
    assert.equal(res.statusCode, null, `${method} ${path} sent no response`);
  }
});

test('share-links: a wrong method on a public path falls through (no 405, storage-free)', async () => {
  const cases = [
    ['POST', '/api/share/tok'],
    ['GET', '/api/share/tok/verify'],
    ['GET', '/api/share/tok/guest/request'],
    ['POST', '/api/share/tok/guest/verify/vtok'],
    ['POST', '/api/share/tok/guest/me'],
  ];
  for (const [method, path] of cases) {
    const { ctx: c, res } = ctx(method, path);
    assert.equal(
      await handleSharePublic(c),
      false,
      `${method} ${path} → false`,
    );
    assert.equal(res.statusCode, null, `${method} ${path} sent no response`);
  }
});

test('share-links: an unknown sub-path falls through', async () => {
  const unknownAuthed = ctx(
    'GET',
    '/api/presentations/p1/share-links/l1/unknown',
  );
  assert.equal(await handleShareLinks(unknownAuthed.ctx), false);

  const unknownPublic = ctx('GET', '/api/share/tok/unknown');
  assert.equal(await handleSharePublic(unknownPublic.ctx), false);

  const foreign = ctx('GET', '/api/shared');
  assert.equal(await handleSharePublic(foreign.ctx), false);
});
