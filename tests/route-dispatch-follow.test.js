/**
 * A7.19 C8 fase 2 — follow + follow-codes route-table migration.
 *
 * Two public-viewer surfaces with different contracts:
 *
 * - `follow.js` — method-less rows: the old chain dispatched on path only and
 *   left method decisions (and SSE/rate limits) to the sub-handlers. The
 *   table must preserve that: every row matches any method.
 * - `follow-codes.js` — Form B: the old chain answered 405 with
 *   `Allow: GET, POST` for anything else under the `/api/follow-codes`
 *   prefix, so the table ends in an explicit catch-all row. The create
 *   handler requires a session (public mount passes `authedUser: null` for
 *   resolve only — the split itself lives in routes/api/index.js).
 *
 * Routing is asserted with `select()` over the exported tables
 * (storage-free); regex captures are asserted directly on the patterns.
 * The follow-codes 401/405 paths return before any storage call, so those
 * are invoked end-to-end.
 *
 * Run with: node --test tests/route-dispatch-follow.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUTES as FOLLOW_ROUTES,
  handleFollowPublic,
} from '../server/routes/api/follow.js';
import {
  ROUTES as CODE_ROUTES,
  handleFollowCodes,
} from '../server/routes/api/follow-codes.js';

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
      req: { method, headers: {}, socket: {} },
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

test('follow: routes resolve to their named sub-handlers in order', () => {
  named(FOLLOW_ROUTES, 'GET', '/api/follow/CODE/state', 'handleFollowState');
  named(
    FOLLOW_ROUTES,
    'GET',
    '/api/follow/CODE/interactions/current',
    'handleFollowInteractionsCurrent',
  );
  named(
    FOLLOW_ROUTES,
    'GET',
    '/api/follow/CODE/interactions/i1/state',
    'handleFollowInteractionState',
  );
  named(
    FOLLOW_ROUTES,
    'POST',
    '/api/follow/CODE/interactions/i1/vote',
    'handleFollowInteractionVote',
  );
  named(
    FOLLOW_ROUTES,
    'POST',
    '/api/follow/CODE/interactions/i1/feedback',
    'handleFollowInteractionFeedback',
  );
  named(
    FOLLOW_ROUTES,
    'POST',
    '/api/follow/CODE/questions',
    'handleFollowQuestions',
  );
  named(
    FOLLOW_ROUTES,
    'GET',
    '/api/follow/CODE/questions/events',
    'handleFollowQuestionsEvents',
  );
  named(
    FOLLOW_ROUTES,
    'POST',
    '/api/follow/CODE/questions/q1/upvote',
    'handleFollowUpvote',
  );
  named(
    FOLLOW_ROUTES,
    'POST',
    '/api/follow/CODE/questions/q1/cancel',
    'handleFollowCancel',
  );
  named(
    FOLLOW_ROUTES,
    'GET',
    '/api/follow/CODE/presentation',
    'handleFollowPresentation',
  );
  named(FOLLOW_ROUTES, 'GET', '/api/follow/CODE/events', 'handleFollowEvents');
});

test('follow: every row is method-less — the sub-handler owns the method decision', () => {
  for (const route of FOLLOW_ROUTES) {
    assert.equal(route.method, undefined, `${route.pattern} carries no method`);
  }
  // Same handler regardless of method, exactly like the old path-only chain.
  assert.equal(
    select(FOLLOW_ROUTES, 'DELETE', '/api/follow/CODE/state')?.handler.name,
    'handleFollowState',
  );
});

test('follow: patterns capture code and ids in handler-argument order', () => {
  captures(FOLLOW_ROUTES, 'GET', '/api/follow/CODE/state', ['CODE']);
  captures(FOLLOW_ROUTES, 'GET', '/api/follow/CODE/interactions/i1/state', [
    'CODE',
    'i1',
  ]);
  captures(FOLLOW_ROUTES, 'POST', '/api/follow/CODE/questions/q1/upvote', [
    'CODE',
    'q1',
  ]);
  captures(FOLLOW_ROUTES, 'POST', '/api/follow/CODE/questions/q1/cancel', [
    'CODE',
    'q1',
  ]);
});

test('follow: /questions does not swallow /questions/events or /questions/:id actions', () => {
  named(
    FOLLOW_ROUTES,
    'GET',
    '/api/follow/CODE/questions/events',
    'handleFollowQuestionsEvents',
  );
  named(
    FOLLOW_ROUTES,
    'POST',
    '/api/follow/CODE/questions/q1/upvote',
    'handleFollowUpvote',
  );
});

test('follow: an unknown sub-path falls through', async () => {
  const unknown = ctx('GET', '/api/follow/CODE/unknown');
  assert.equal(await handleFollowPublic(unknown.ctx), false);

  const bare = ctx('GET', '/api/follow/CODE');
  assert.equal(await handleFollowPublic(bare.ctx), false);

  const foreign = ctx('GET', '/api/following');
  assert.equal(await handleFollowPublic(foreign.ctx), false);
});

test('follow-codes: routes resolve to their named handlers in order', () => {
  named(CODE_ROUTES, 'POST', '/api/follow-codes', 'handleFollowCodeCreate');
  named(
    CODE_ROUTES,
    'GET',
    '/api/follow-codes/ABCD',
    'handleFollowCodeResolve',
  );
  captures(CODE_ROUTES, 'GET', '/api/follow-codes/ABCD', ['ABCD']);
  // Case-insensitive resolve, as before (the handler upper-cases the code).
  captures(CODE_ROUTES, 'GET', '/api/follow-codes/abcd', ['abcd']);
});

test('follow-codes: minting without a session is a 401 before any storage call', async () => {
  const { ctx: c, res } = ctx('POST', '/api/follow-codes');
  assert.equal(await handleFollowCodes(c), true);
  assert.equal(res.statusCode, 401);
});

test('follow-codes: anything else under the prefix answers 405 with Allow (Form B)', async () => {
  const cases = [
    ['GET', '/api/follow-codes'],
    ['DELETE', '/api/follow-codes'],
    ['POST', '/api/follow-codes/ABCD'],
    ['GET', '/api/follow-codes/TOOLONGCODE'],
    ['GET', '/api/follow-codes/ABCD/extra'],
  ];
  for (const [method, path] of cases) {
    const { ctx: c, res } = ctx(method, path, {
      authedUser: { email: 'a@b.test' },
    });
    assert.equal(
      await handleFollowCodes(c),
      true,
      `${method} ${path} → handled`,
    );
    assert.equal(res.statusCode, 405, `${method} ${path} → 405`);
    assert.equal(
      res.headers.Allow,
      'GET, POST',
      `${method} ${path} pins Allow`,
    );
  }
});

test('follow-codes: outside the prefix the module declines', async () => {
  const { ctx: c, res } = ctx('GET', '/api/follow');
  assert.equal(await handleFollowCodes(c), false);
  assert.equal(res.statusCode, null);
});

test('follow-codes: a prefix-typo path is declined, not 405ed', async () => {
  // The entry guard (bare startsWith) admits /api/follow-codesfoo, but no
  // row matches — the catch-all covers the bare path and /api/follow-codes/*
  // only. Deliberate narrowing vs the old chain, which answered an
  // accidental 405 here; the root dispatcher turns the decline into a 404
  // like every other module's unmatched garbage.
  const { ctx: c, res } = ctx('GET', '/api/follow-codesfoo');
  assert.equal(await handleFollowCodes(c), false);
  assert.equal(res.statusCode, null);
});
