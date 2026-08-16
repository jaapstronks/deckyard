/**
 * A7.19-C7h — the public follow surface shape-checks the presentation id.
 *
 * Every `/api/follow/:id/...` row queries Postgres `uuid` columns with the id
 * verbatim (present_sessions, presentations), so a non-uuid id used to 500
 * out of the uuid parser (22P02) before any reason mapping. The guard in
 * `routes/api/follow.js` answers `404 not_found` instead, before storage is
 * touched — pinned here by running the handler with no database at all: a
 * guard that let the id through would surface as a different response.
 *
 * Run with: node --test tests/follow-uuid-guard.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';

import { handleFollowPublic } from '../server/routes/api/follow.js';
import { isUuid, UUID_RE } from '../server/utils/uuid.js';

/** Minimal ServerResponse stand-in that records status and body. */
class MockRes {
  constructor() {
    this.statusCode = null;
    this.chunks = [];
    this.headersSent = false;
  }
  writeHead(status) {
    this.statusCode = status;
    this.headersSent = true;
    return this;
  }
  end(chunk) {
    if (chunk != null) this.chunks.push(Buffer.from(chunk));
  }
  body() {
    return JSON.parse(Buffer.concat(this.chunks).toString('utf8'));
  }
}

function ctxFor(method, pathname) {
  return {
    repoRoot: process.cwd(),
    req: { method, headers: {} },
    res: new MockRes(),
    url: new URL(`http://localhost${pathname}`),
  };
}

test('isUuid accepts the canonical shape and nothing else', () => {
  assert.equal(isUuid('123e4567-e89b-42d3-a456-426614174000'), true);
  assert.equal(isUuid('123E4567-E89B-42D3-A456-426614174000'), true, 'case-insensitive');
  assert.equal(isUuid('nonexistent'), false);
  assert.equal(isUuid('123e4567e89b42d3a456426614174000'), false, 'hyphens required');
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(42), false);
  assert.equal(UUID_RE.test('123e4567-e89b-42d3-a456-426614174000'), true);
});

test('a non-uuid presentation id answers 404 not_found on every follow path', async () => {
  const paths = [
    ['GET', '/api/follow/nonexistent/state'],
    ['GET', '/api/follow/nonexistent/interactions/current'],
    ['POST', '/api/follow/nonexistent/interactions/slide-1/vote'],
    ['POST', '/api/follow/nonexistent/questions'],
    ['POST', '/api/follow/nonexistent/questions/also-not-a-uuid/upvote'],
    ['GET', '/api/follow/nonexistent/presentation'],
  ];
  for (const [method, pathname] of paths) {
    const ctx = ctxFor(method, pathname);
    const handled = await handleFollowPublic(ctx);
    assert.equal(handled, true, `${pathname}: handled`);
    assert.equal(ctx.res.statusCode, 404, `${pathname}: 404`);
    const body = ctx.res.body();
    assert.equal(body.ok, false, `${pathname}: ok:false`);
    assert.equal(body.error, 'not_found', `${pathname}: machine code`);
  }
});

test('a uuid-shaped presentation id passes the guard into normal dispatch', async () => {
  // The state handler answers a wrong method with 405 before it touches
  // storage — reaching that proves the guard let the uuid through into the
  // route table rather than short-circuiting everything to 404.
  const ctx = ctxFor('PUT', '/api/follow/123e4567-e89b-42d3-a456-426614174000/state');
  const handled = await handleFollowPublic(ctx);
  assert.equal(handled, true);
  assert.equal(ctx.res.statusCode, 405);
});

test('paths outside the follow table still fall through unhandled', async () => {
  const ctx = ctxFor('GET', '/api/follow-codes/ABCDEF');
  const handled = await handleFollowPublic(ctx);
  assert.equal(handled, false, 'follow-codes is a different mount');
});
