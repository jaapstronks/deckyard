/**
 * B55 — the slide-library tag PUTs take one canonical body shape.
 *
 * `PUT /api/slide-library/{personal,team}/:id/tags` accepts `{ tags: [...] }`
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

function mockRes() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    writeHead(c, headers) { this.statusCode = c; Object.assign(this.headers, headers); },
    end(payload) { this.payload = payload ? JSON.parse(payload) : null; },
    setHeader(k, v) { this.headers[k] = v; },
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

for (const scope of ['personal', 'team']) {
  test(`${scope} tags PUT: a bare array body is a 400 (object guarantee, no opt-out)`, async () => {
    const { ctx, res } = putCtx(`/api/slide-library/${scope}/item-1/tags`, '["a","b"]');
    assert.equal(await handleSlideLibrary(ctx), true);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.message, 'Request body must be a JSON object');
  });

  test(`${scope} tags PUT: a non-array tags field is a 400`, async () => {
    const { ctx, res } = putCtx(`/api/slide-library/${scope}/item-1/tags`, '{"tags":"a"}');
    assert.equal(await handleSlideLibrary(ctx), true);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.message, 'Expected { tags: [...] }');
  });

  test(`${scope} tags PUT: a missing tags field is a 400`, async () => {
    const { ctx, res } = putCtx(`/api/slide-library/${scope}/item-1/tags`, '{}');
    assert.equal(await handleSlideLibrary(ctx), true);
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.message, 'Expected { tags: [...] }');
  });
}
