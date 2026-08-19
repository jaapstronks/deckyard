/**
 * A7.19 C8 fase 2 — the closing migrations behind the root dispatcher
 * (`routes/api/index.js`), reviewed as security-sensitive:
 *
 * - the maintenance endpoint moves to a `MAINTENANCE_ROUTES` table
 *   (Form B: any non-GET on the path answered 405 before and still does);
 * - the public follow-code read moves from an inline regex in `index.js` to
 *   the `PUBLIC_ROUTES` table in `follow-codes.js` — which reads skip the
 *   login gate is now an explicit, reviewable row. The table must expose
 *   exactly the GET resolve and nothing else;
 * - the `/api/v1` prefix probe in `index.js` is gone; `handlePublicApiV1`
 *   carries its own prefix guard and declines everything else.
 *
 * All assertions here are storage-free: the maintenance handler reads
 * config only, and every refusal path returns before a storage call.
 *
 * Run with: node --test tests/c8-routes-gate-close-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAINTENANCE_ROUTES } from '../server/routes/api/index.js';
import { dispatchRoutes } from '../server/utils/router.js';
import {
  PUBLIC_ROUTES,
  ROUTES as CODE_ROUTES,
  handleFollowCodesPublic,
} from '../server/routes/api/follow-codes.js';
import { handlePublicApiV1 } from '../server/routes/public-api/v1/index.js';

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    writeHead(c, headers) {
      this.statusCode = c;
      Object.assign(this.headers, headers);
    },
    end(chunk) {
      this.body = chunk;
    },
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
      authedUser: null,
      req: { method, headers: {} },
      res,
      url: { pathname, searchParams: new URLSearchParams() },
    },
  };
}

test('maintenance: GET answers 200 with the state, any other method 405 with Allow: GET', async () => {
  const get = ctx('GET', '/api/maintenance');
  assert.equal(await dispatchRoutes(MAINTENANCE_ROUTES, get.ctx), true);
  assert.equal(get.res.statusCode, 200);
  assert.ok(JSON.parse(get.res.body), 'GET body is the JSON maintenance state');

  for (const method of ['POST', 'PUT', 'DELETE']) {
    const { ctx: c, res } = ctx(method, '/api/maintenance');
    assert.equal(
      await dispatchRoutes(MAINTENANCE_ROUTES, c),
      true,
      `${method} → handled`,
    );
    assert.equal(res.statusCode, 405, `${method} → 405`);
    assert.equal(res.headers.Allow, 'GET', `${method} pins Allow: GET`);
  }

  const other = ctx('GET', '/api/maintenance-window');
  assert.equal(
    await dispatchRoutes(MAINTENANCE_ROUTES, other.ctx),
    false,
    'other paths decline',
  );
});

test('follow-codes: the public table exposes exactly the GET resolve, nothing else', () => {
  assert.equal(PUBLIC_ROUTES.length, 1, 'one public row');
  const [row] = PUBLIC_ROUTES;
  assert.equal(row.method, 'GET');
  assert.equal(row.handler.name, 'handleFollowCodeResolve');
  assert.ok(row.pattern.exec('/api/follow-codes/ABCD'), 'resolve path matches');
  assert.ok(
    row.pattern.exec('/api/follow-codes/abcd'),
    'case-insensitive, as before',
  );
  assert.equal(
    row.pattern.exec('/api/follow-codes'),
    null,
    'the mint path is not public',
  );
  assert.equal(
    row.pattern.exec('/api/follow-codes/TOOLONGCODE'),
    null,
    'no overlong codes',
  );

  // The public row is the same pattern + handler as the authed resolve row —
  // one behaviour, mounted twice around the gate.
  const authedResolve = CODE_ROUTES.find(
    (r) => r.handler.name === 'handleFollowCodeResolve',
  );
  assert.equal(authedResolve.pattern, row.pattern, 'shared pattern object');
});

test('follow-codes: the pre-gate entry declines everything that must wait for the gate', async () => {
  const cases = [
    ['POST', '/api/follow-codes'], // minting requires a session
    ['DELETE', '/api/follow-codes/ABCD'], // the 405 surface stays behind the gate
    ['GET', '/api/follow-codes/TOOLONGCODE'],
    ['GET', '/api/follow-codes'],
  ];
  for (const [method, path] of cases) {
    const { ctx: c, res } = ctx(method, path);
    assert.equal(
      await handleFollowCodesPublic(c),
      false,
      `${method} ${path} → false`,
    );
    assert.equal(
      res.statusCode,
      null,
      `${method} ${path} sent no response pre-gate`,
    );
  }
});

test('public-api v1: the module declines non-v1 paths itself (the index.js probe is gone)', async () => {
  const { ctx: c, res } = ctx('GET', '/api/presentations');
  assert.equal(await handlePublicApiV1(c), false);
  assert.equal(res.statusCode, null);
});
