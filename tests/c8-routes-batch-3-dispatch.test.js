/**
 * A7.19 C8 fase 2 — batch 3 route-table migration.
 *
 * convert (three exact Form A paths), questions (two POST-only regex paths that
 * sent an explicit 405), and profile (module prefix + email guard, own-image
 * Form B, and an admin `/:email` combined handler) move to declarative ROUTES
 * tables. See docs/reference/route-dispatch.md.
 *
 * Routing is asserted with `select()` over the exported ROUTES (storage-free);
 * preserved 405s and the module guards are asserted by invoking the entry with
 * a wrong method / missing auth, which never reaches a real storage handler.
 *
 * Run with: node --test tests/c8-routes-batch-3-dispatch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROUTES as CONVERT_ROUTES, handleConvert } from '../server/routes/api/convert.js';
import { ROUTES as QUESTIONS_ROUTES, handleQuestions } from '../server/routes/api/questions.js';
import { ROUTES as PROFILE_ROUTES, handleProfile } from '../server/routes/api/profile.js';

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

// ─── convert (three exact Form A paths, no module guard) ───

test('convert: routes resolve to their named handlers in order', () => {
  named(CONVERT_ROUTES, 'POST', '/api/convert', 'handleConvertFile');
  named(CONVERT_ROUTES, 'POST', '/api/convert/stream', 'handleConvertStream');
  named(CONVERT_ROUTES, 'GET', '/api/convert/status', 'handleConvertStatus');
});

test('convert: a wrong method falls through (no 405)', async () => {
  for (const [method, path] of [
    ['GET', '/api/convert'],
    ['DELETE', '/api/convert/stream'],
    ['POST', '/api/convert/status'],
  ]) {
    assert.equal(select(CONVERT_ROUTES, method, path), null);
    const { ctx: c } = ctx(method, path);
    assert.equal(await handleConvert(c), false, `${method} ${path} not handled`);
  }
});

test('convert: an unknown sub-path falls through', async () => {
  const { ctx: c } = ctx('POST', '/api/convert/nope');
  assert.equal(await handleConvert(c), false);
});

// ─── questions (two POST-only regex paths, Form B) ───

const REMOVE = '/api/moderate/deck1/questions/q1/remove';
const PROMOTE = '/api/moderate/deck1/questions/q1/promote';

test('questions: routes resolve to their named handlers', () => {
  named(QUESTIONS_ROUTES, 'POST', REMOVE, 'handleQuestionRemove');
  named(QUESTIONS_ROUTES, 'POST', PROMOTE, 'handleQuestionPromote');
});

test('questions: a wrong method 405s on each path', async () => {
  for (const path of [REMOVE, PROMOTE]) {
    const { ctx: c, res } = ctx('GET', path);
    await handleQuestions(c);
    assert.equal(res.statusCode, 405, `GET ${path} → 405`);
  }
});

test('questions: an unmatched moderate path falls through', async () => {
  const { ctx: c } = ctx('POST', '/api/moderate/deck1/questions/q1/other');
  assert.equal(await handleQuestions(c), false);
});

// ─── profile (module prefix + email guard; Form B own image; admin combined) ───

test('profile: routes resolve to their named handlers', () => {
  named(PROFILE_ROUTES, 'POST', '/api/profile/image', 'handleProfileImageUpload');
  named(PROFILE_ROUTES, 'DELETE', '/api/profile/image', 'handleProfileImageDelete');
  named(PROFILE_ROUTES, 'POST', '/api/profile/image/x%40y.test', 'handleProfileImageAdmin');
});

test('profile: the module guards run before dispatch', () => {
  // Prefix guard: a foreign path falls through.
  assert.equal(handleProfile(ctx('GET', '/api/not-profile/').ctx), false);
  // Email guard: no email → 401, not a fall-through.
  const noEmail = ctx('POST', '/api/profile/image', { email: '' });
  handleProfile(noEmail.ctx);
  assert.equal(noEmail.res.statusCode, 401);
});

test('profile: a wrong method on the own-image path 405s', async () => {
  const { ctx: c, res } = ctx('PATCH', '/api/profile/image');
  await handleProfile(c);
  assert.equal(res.statusCode, 405);
});

test('profile: an unknown profile sub-path falls through', async () => {
  const { ctx: c } = ctx('GET', '/api/profile/nope');
  assert.equal(await handleProfile(c), false);
});
