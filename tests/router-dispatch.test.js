/**
 * The shared route dispatcher (A7.19 C8 fase 1). `dispatchRoutes(ROUTES, ctx)`
 * is the matcher extracted verbatim from routes/api/presentations.js so that
 * presentations.js and ai.js — and later the ~60 other route modules — share
 * one first-match form instead of hand-rolling a loop each.
 *
 * These pin the contract the migration depends on: exact string match, RegExp
 * capture groups passed as trailing args, method-mismatch fall-through (not a
 * 405), first-match order, and `false` on no match.
 *
 * Run with: node --test tests/router-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { dispatchRoutes } from '../server/utils/router.js';

/** A context carrying just what the dispatcher reads. */
function ctx(method, pathname) {
  return { req: { method }, url: { pathname } };
}

test('a string pattern is an exact pathname match', () => {
  const routes = [{ method: 'GET', pattern: '/api/x', handler: () => 'hit' }];
  assert.equal(dispatchRoutes(routes, ctx('GET', '/api/x')), 'hit');
  assert.equal(
    dispatchRoutes(routes, ctx('GET', '/api/x/y')),
    false,
    'no prefix match',
  );
});

test('a RegExp pattern passes its capture groups as trailing args', () => {
  const seen = [];
  const routes = [
    {
      pattern: /^\/api\/p\/([^/]+)\/c\/([^/]+)$/,
      handler: (_ctx, a, b) => {
        seen.push(a, b);
        return 'hit';
      },
    },
  ];
  assert.equal(dispatchRoutes(routes, ctx('POST', '/api/p/42/c/7')), 'hit');
  assert.deepEqual(seen, ['42', '7'], 'both captures forwarded, in order');
});

test('the context is forwarded verbatim as the first handler argument', () => {
  const c = ctx('GET', '/api/x');
  let received = null;
  const routes = [
    {
      pattern: '/api/x',
      handler: (given) => {
        received = given;
        return true;
      },
    },
  ];
  dispatchRoutes(routes, c);
  assert.equal(received, c, 'same context object, not a copy');
});

test('a method mismatch falls through to the next route, it is not a 405', () => {
  const routes = [
    { method: 'GET', pattern: '/api/x', handler: () => 'get' },
    { method: 'POST', pattern: '/api/x', handler: () => 'post' },
  ];
  assert.equal(
    dispatchRoutes(routes, ctx('POST', '/api/x')),
    'post',
    'second route wins',
  );
  assert.equal(
    dispatchRoutes(routes, ctx('DELETE', '/api/x')),
    false,
    'no route, falls through',
  );
});

test('a route with no method matches any method', () => {
  const routes = [{ pattern: '/api/x', handler: () => 'any' }];
  assert.equal(dispatchRoutes(routes, ctx('DELETE', '/api/x')), 'any');
});

test('first match wins: a specific path ahead of a generic one is not shadowed', () => {
  const routes = [
    {
      method: 'GET',
      pattern: '/api/presentations/search',
      handler: () => 'search',
    },
    { pattern: /^\/api\/presentations\/([^/]+)$/, handler: () => 'item' },
  ];
  assert.equal(
    dispatchRoutes(routes, ctx('GET', '/api/presentations/search')),
    'search',
    'the earlier exact route wins over the later :id pattern',
  );
  assert.equal(
    dispatchRoutes(routes, ctx('GET', '/api/presentations/abc')),
    'item',
  );
});

test('no matching route returns false so the caller can fall through', () => {
  const routes = [{ pattern: '/api/x', handler: () => true }];
  assert.equal(dispatchRoutes(routes, ctx('GET', '/api/nope')), false);
});
