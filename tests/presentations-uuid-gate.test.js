/**
 * B222 — the authed presentation surface shape-checks the presentation id.
 *
 * Every `/api/presentations/:id/...` row hands the captured id to storage
 * verbatim, and storage queries Postgres `uuid` columns with it — so a
 * non-uuid id used to 500 out of the uuid parser (22P02, `internal_error`)
 * before any reason mapping, and the editor showed its fatal app error
 * instead of "Presentation Not Found". The gate in
 * `utils/router.js#requireUuidId`, declared per row in
 * `routes/api/presentations/index.js`, answers `404 not_found` instead.
 *
 * Pinned here by running the module with no database at all: an id that
 * reaches storage surfaces as `500 internal_error`, so the uuid rows below
 * double as proof that the gate lets a well-shaped id through rather than
 * short-circuiting everything to 404.
 *
 * Run with: node --test tests/presentations-uuid-gate.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';

import { handlePresentations } from '../server/routes/api/presentations/index.js';
import { handleCollaborators } from '../server/routes/api/collaborators.js';

const A_UUID = '123e4567-e89b-42d3-a456-426614174000';

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
    storageScope: { organizationId: 'org-1', userId: 'u1' },
    req: { method, headers: {} },
    res: new MockRes(),
    url: new URL(`http://localhost${pathname}`),
    authedUser: { id: 'u1', email: 'owner@example.test', role: 'user' },
  };
}

test('a non-uuid presentation id answers 404 not_found on every id row', async () => {
  const paths = [
    ['GET', '/api/presentations/does-not-exist/comments'],
    ['POST', '/api/presentations/does-not-exist/comments'],
    ['GET', '/api/presentations/does-not-exist/comments/counts'],
    ['GET', '/api/presentations/does-not-exist/comments/also-not-a-uuid'],
    ['GET', '/api/presentations/does-not-exist/revision'],
    ['GET', '/api/presentations/does-not-exist/versions'],
    ['GET', '/api/presentations/does-not-exist/tags'],
    ['GET', '/api/presentations/does-not-exist/thumbnail'],
    ['GET', '/api/presentations/does-not-exist/slide-locks'],
    ['POST', '/api/presentations/does-not-exist/duplicate'],
    ['PUT', '/api/presentations/does-not-exist/visibility'],
    ['POST', '/api/presentations/does-not-exist/restore'],
    ['DELETE', '/api/presentations/does-not-exist/permanent'],
  ];
  for (const [method, pathname] of paths) {
    const ctx = ctxFor(method, pathname);
    const handled = await handlePresentations(ctx);
    assert.equal(handled, true, `${pathname}: handled`);
    assert.equal(ctx.res.statusCode, 404, `${method} ${pathname}: 404`);
    const body = ctx.res.body();
    assert.equal(body.ok, false, `${pathname}: ok:false`);
    assert.equal(body.error, 'not_found', `${pathname}: machine code`);
  }
});

test('the bare :id row hands a non-uuid segment back to the chain', async () => {
  // This row shares its shape with the collection routes of sibling modules
  // (`/api/presentations/shared-with-me` in collaborators.js) and with its own
  // method-dispatched neighbours, which is why it falls through instead of
  // answering 404 itself. The chain's terminal `notFound` gives the client the
  // same answer when nobody else claims the path.
  for (const pathname of [
    '/api/presentations/does-not-exist',
    '/api/presentations/shared-with-me',
    '/api/presentations/popular', // POST: the GET row above it does not match
  ]) {
    const ctx = ctxFor('POST', pathname);
    const handled = await handlePresentations(ctx);
    assert.equal(handled, false, `${pathname}: falls through`);
    assert.equal(ctx.res.statusCode, null, `${pathname}: nothing written`);
  }
});

test('a uuid-shaped id passes the gate into normal dispatch', async () => {
  // With no database reachable, a row that reached storage answers
  // `500 internal_error` — the gate did not stand in its way.
  for (const [method, pathname] of [
    ['GET', `/api/presentations/${A_UUID}`],
    ['GET', `/api/presentations/${A_UUID}/comments`],
    ['GET', `/api/presentations/${A_UUID}/revision`],
  ]) {
    const ctx = ctxFor(method, pathname);
    const handled = await handlePresentations(ctx);
    assert.equal(handled, true, `${pathname}: handled`);
    assert.notEqual(ctx.res.statusCode, 404, `${pathname}: not gated out`);
  }
});

// ---------------------------------------------------------------------------
// The collaborator rows of the same surface (B359)
// ---------------------------------------------------------------------------

test('a non-uuid presentation id answers 404 on every collaborator row', async () => {
  // All four id-carrying rows, not one of them as a stand-in for the others:
  // the gate is declared per row, so a row that lost it fails only here.
  const rows = [
    ['POST', '/api/presentations/does-not-exist/collaborators'],
    ['GET', '/api/presentations/does-not-exist/collaborators'],
    ['DELETE', '/api/presentations/does-not-exist/collaborators/a%40b.test'],
    ['PATCH', '/api/presentations/does-not-exist/collaborators/a%40b.test'],
  ];
  for (const [method, pathname] of rows) {
    const ctx = ctxFor(method, pathname);
    const handled = await handleCollaborators(ctx);
    assert.equal(handled, true, `${method} ${pathname}: handled`);
    assert.equal(ctx.res.statusCode, 404, `${method} ${pathname}: 404`);
    const body = ctx.res.body();
    assert.equal(body.ok, false, `${pathname}: ok:false`);
    assert.equal(body.error, 'not_found', `${pathname}: machine code`);
  }
});

test('a uuid-shaped id passes the collaborator gate into normal dispatch', async () => {
  // Same proof as for the presentation rows: with no database reachable, a row
  // that got through answers 500 — the gate did not short-circuit everything.
  for (const [method, pathname] of [
    ['GET', `/api/presentations/${A_UUID}/collaborators`],
    ['POST', `/api/presentations/${A_UUID}/collaborators`],
    ['DELETE', `/api/presentations/${A_UUID}/collaborators/a%40b.test`],
    ['PATCH', `/api/presentations/${A_UUID}/collaborators/a%40b.test`],
  ]) {
    const ctx = ctxFor(method, pathname);
    const handled = await handleCollaborators(ctx);
    assert.equal(handled, true, `${method} ${pathname}: handled`);
    assert.notEqual(ctx.res.statusCode, 404, `${pathname}: not gated out`);
  }
});

test('shared-with-me carries no id and so no gate', async () => {
  // The one collaborator row without a capture group: it must keep answering
  // for the caller's own session rather than 404 on a path shape.
  const ctx = ctxFor('GET', '/api/presentations/shared-with-me');
  const handled = await handleCollaborators(ctx);
  assert.equal(handled, true, 'handled');
  assert.notEqual(ctx.res.statusCode, 404, 'not gated out');
});

test('an uppercase uuid is a uuid', async () => {
  const ctx = ctxFor('GET', `/api/presentations/${A_UUID.toUpperCase()}/tags`);
  await handlePresentations(ctx);
  assert.notEqual(ctx.res.statusCode, 404);
});
