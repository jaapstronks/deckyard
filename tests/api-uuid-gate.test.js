/**
 * B399 — every `/api/*` row that captures a uuid declares it, so a non-uuid
 * answers 404 instead of reaching a Postgres `uuid` column as a 500.
 *
 * B360 put the declaration (`captures`) on three tables; B399 carried it to
 * the rest of `server/routes/api/`. The export routes are the case the naloop
 * named: `GET /api/presentations/foo/export/json` left the uuid parser as
 * `500 internal_error` (22P02). They used to match their own paths inside
 * `server/export/pipeline.js`; they are now rows of the export `ROUTES` table
 * and pass through the one gate in `utils/router.js`.
 *
 * Run with no database: an id that reaches storage surfaces as a 500, so the
 * uuid cases below prove the gate lets a well-shaped id through rather than
 * short-circuiting everything to 404. `route-captures-guard.test.js` holds the
 * declarations themselves; this file pins what a request sees.
 *
 * Run with: node --test tests/api-uuid-gate.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';

import { handleExports } from '../server/routes/api/export.js';
import { handleAnalytics } from '../server/routes/api/analytics/index.js';
import { handleShareLinks } from '../server/routes/api/share-links/index.js';
import { handleSlideLibrary } from '../server/routes/api/slide-library.js';
import { handleThemes } from '../server/routes/api/themes.js';

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
  setHeader() {}
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
    authedUser: { id: 'u1', email: 'owner@example.test', role: 'admin' },
  };
}

async function statusOf(handler, method, pathname) {
  const ctx = ctxFor(method, pathname);
  const handled = await handler(ctx);
  assert.equal(handled, true, `${method} ${pathname}: handled`);
  return ctx;
}

test('a non-uuid presentation id on an export route answers 404 not_found', async () => {
  const ctx = await statusOf(
    handleExports,
    'GET',
    '/api/presentations/foo/export/json',
  );
  assert.equal(ctx.res.statusCode, 404);
  assert.equal(ctx.res.body().error, 'not_found');
});

test('every export route gates its presentation id', async () => {
  for (const tail of [
    'json',
    'deck.zip',
    'html',
    'pdf',
    'pdf-slides',
    'pdf-slides.pdf',
    'png',
    'png.zip',
    'png/1.png',
    'pptx',
    'pptx-template',
    'handoff.zip',
    'notes.md',
    'notes.docx',
  ]) {
    const pathname = `/api/presentations/foo/export/${tail}`;
    const ctx = await statusOf(handleExports, 'GET', pathname);
    assert.equal(ctx.res.statusCode, 404, `${pathname}: 404`);
  }
});

test('a uuid presentation id passes the export gate', async () => {
  // No database: reaching storage is the 500, which is the point.
  const ctx = await statusOf(
    handleExports,
    'GET',
    `/api/presentations/${A_UUID}/export/json`,
  );
  assert.notEqual(ctx.res.statusCode, 404);
});

test('an export path with a wrong method still falls through', async () => {
  const ctx = ctxFor('POST', '/api/presentations/foo/export/json');
  assert.equal(await handleExports(ctx), false);
});

test('the swept tables gate every uuid capture, not just the first', async () => {
  const cases = [
    [handleAnalytics, 'GET', '/api/presentations/foo/analytics'],
    [
      handleAnalytics,
      'GET',
      `/api/presentations/${A_UUID}/analytics/reports/nope`,
    ],
    [handleShareLinks, 'GET', '/api/presentations/foo/share-links'],
    [
      handleShareLinks,
      'DELETE',
      `/api/presentations/${A_UUID}/share-links/${A_UUID}/guests/nope`,
    ],
    [handleSlideLibrary, 'PATCH', '/api/slide-library/personal/nope'],
    // Was `([a-f0-9-]+)`: a non-hex id fell through the table entirely.
    [handleThemes, 'GET', '/api/themes/custom/nope'],
    // Hex-and-dashes but not a uuid: the old pattern let this reach storage.
    [handleThemes, 'GET', '/api/themes/custom/abc-123'],
  ];
  for (const [handler, method, pathname] of cases) {
    const ctx = await statusOf(handler, method, pathname);
    assert.equal(ctx.res.statusCode, 404, `${method} ${pathname}: 404`);
  }
});
