/**
 * B55 — the slide-library tag PUTs take one canonical body shape.
 *
 * `PUT /api/slide-library/{personal,organization}/:id/tags` accepts `{ tags: [...] }`
 * and nothing else. The historical bare-array body (`["a","b"]`) is a 400 from
 * the entry's object guarantee, and a present-but-non-array `tags` is a 400
 * from the handler — both before any storage call, which is what keeps these
 * tests storage-free.
 *
 * Run with: node --test tests/slide-library-tag-put-shape.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleSlideLibrary } from '../server/routes/api/slide-library.js';

/** A library item id: a `uuid` column, declared so by the route (B399). */
const ITEM_ID = '5b0c9d1e-2f3a-4b5c-8d6e-7f8091a2b3c4';

function mockRes() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    writeHead(c, headers) {
      this.statusCode = c;
      Object.assign(this.headers, headers);
    },
    end(payload) {
      this.payload = payload ? JSON.parse(payload) : null;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
  };
}

function putCtx(path, rawBody) {
  const req = Readable.from([Buffer.from(rawBody)]);
  req.method = 'PUT';
  req.headers = {};
  const res = mockRes();
  return {
    res,
    ctx: {
      repoRoot: '/tmp',
      storageScope: {},
      authedUser: { email: 'a@b.test' },
      req,
      res,
      url: { pathname: path, searchParams: new URLSearchParams() },
    },
  };
}

for (const shelf of ['personal', 'organization']) {
  test(`${shelf} tags PUT: a bare array body is a 400 (object guarantee, no opt-out)`, async () => {
    const { ctx, res } = putCtx(
      `/api/slide-library/${shelf}/${ITEM_ID}/tags`,
      '["a","b"]',
    );
    assert.equal(await handleSlideLibrary(ctx), true);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.message, 'Request body must be a JSON object');
  });

  test(`${shelf} tags PUT: a non-array tags field is a 400`, async () => {
    const { ctx, res } = putCtx(
      `/api/slide-library/${shelf}/${ITEM_ID}/tags`,
      '{"tags":"a"}',
    );
    assert.equal(await handleSlideLibrary(ctx), true);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.message, 'Expected { tags: [...] }');
  });

  test(`${shelf} tags PUT: a missing tags field is a 400`, async () => {
    const { ctx, res } = putCtx(
      `/api/slide-library/${shelf}/${ITEM_ID}/tags`,
      '{}',
    );
    assert.equal(await handleSlideLibrary(ctx), true);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.message, 'Expected { tags: [...] }');
  });
}
