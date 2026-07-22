/**
 * Regression: the admin If-Match escape hatch is gone.
 *
 * The presentation write routes (PUT /:id, POST /:id/scope, POST
 * /:id/versions/:v/restore) used to exempt admins from the optimistic-lock
 * header — an admin request without If-Match got expectedRevision=null, a blind
 * overwrite with no slide-level merge that could wipe slides the admin never
 * loaded. That bypass was removed (TODO "Wacht op een beslissing" #2a, option
 * A): every writer, admins included, must supply If-Match and go through the
 * same merge path.
 *
 * These tests drive the real route handlers against a temp storage root and
 * assert both the admin and the owner get 428 without If-Match, and that a
 * well-formed If-Match still succeeds for an admin (the merge path is intact,
 * not just blanket-blocked).
 *
 * Run with: node --test tests/admin-ifmatch-required.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let repoRoot;
let createPresentation;
let getPresentation;
let handlePresentationItem;
let handlePresentationScope;
let handlePresentationRestoreVersion;
let createPresentationVersion;

const OWNER = 'owner@example.com';

test.before(async () => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-ifmatch-repo-'));
  ({ createPresentation, getPresentation, createPresentationVersion } = await import(
    '../server/storage/presentations.js'
  ));
  ({ handlePresentationItem } = await import(
    '../server/routes/api/presentations/presentation.js'
  ));
  ({ handlePresentationScope } = await import(
    '../server/routes/api/presentations/scope.js'
  ));
  ({ handlePresentationRestoreVersion } = await import(
    '../server/routes/api/presentations/restore.js'
  ));
});

test.after(() => {
  try {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** A request whose body streams `body` as JSON, with the given method/headers. */
function fakeReq({ method = 'PUT', headers = {}, body = null } = {}) {
  const buf = Buffer.from(body == null ? '' : JSON.stringify(body), 'utf8');
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

function fakeRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

/** Create a fresh deck owned by OWNER; returns the stored presentation. */
async function seedDeck() {
  return createPresentation(repoRoot, {
    title: 'Lockable deck',
    ownerEmail: OWNER,
    slides: [{ id: 's1', type: 'content-slide', content: { title: 'A', body: 'Hello' } }],
  });
}

const admin = { email: OWNER, isAdmin: true };
const owner = { email: OWNER, isAdmin: false };

test('PUT without If-Match is 428 for an admin (escape hatch removed)', async () => {
  const pres = await seedDeck();
  const res = fakeRes();
  await handlePresentationItem(
    {
      repoRoot,
      req: fakeReq({ method: 'PUT', headers: {}, body: { title: 'Changed' } }),
      res,
      url: `/api/presentations/${pres.id}`,
      authedUser: admin,
    },
    pres.id
  );
  assert.equal(res.statusCode, 428, 'admin must supply If-Match, no blind overwrite');
  // The deck is untouched — the write never happened.
  const after = await getPresentation(repoRoot, pres.id);
  assert.equal(after.title, 'Lockable deck', 'title unchanged');
});

test('PUT without If-Match is 428 for a non-admin owner too', async () => {
  const pres = await seedDeck();
  const res = fakeRes();
  await handlePresentationItem(
    {
      repoRoot,
      req: fakeReq({ method: 'PUT', headers: {}, body: { title: 'Changed' } }),
      res,
      url: `/api/presentations/${pres.id}`,
      authedUser: owner,
    },
    pres.id
  );
  assert.equal(res.statusCode, 428);
});

test('PUT with a matching If-Match still succeeds for an admin', async () => {
  const pres = await seedDeck();
  const res = fakeRes();
  await handlePresentationItem(
    {
      repoRoot,
      req: fakeReq({
        method: 'PUT',
        headers: { 'if-match': String(pres.revision) },
        body: { ...pres, title: 'Properly merged' },
      }),
      res,
      url: `/api/presentations/${pres.id}`,
      authedUser: admin,
    },
    pres.id
  );
  assert.equal(res.statusCode, 200, 'the merge path is intact, not blanket-blocked');
  const after = await getPresentation(repoRoot, pres.id);
  assert.equal(after.title, 'Properly merged');
});

test('POST /scope without If-Match is 428 for an admin', async () => {
  const pres = await seedDeck();
  const res = fakeRes();
  await handlePresentationScope(
    {
      repoRoot,
      req: fakeReq({ method: 'PATCH', headers: {}, body: { scope: 'workspace' } }),
      res,
      authedUser: admin,
    },
    pres.id
  );
  assert.equal(res.statusCode, 428);
});

test('POST /restore without If-Match is 428 for an admin', async () => {
  const pres = await seedDeck();
  const version = await createPresentationVersion(repoRoot, pres.id, pres, {
    actorEmail: OWNER,
  });
  const res = fakeRes();
  await handlePresentationRestoreVersion(
    {
      repoRoot,
      req: fakeReq({ method: 'POST', headers: {}, body: {} }),
      res,
      authedUser: admin,
    },
    pres.id,
    version?.id
  );
  assert.equal(res.statusCode, 428);
});
