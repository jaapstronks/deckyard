/**
 * The route half of the slide-library save contract (D170, B335).
 *
 * `PATCH /api/slide-library/<shelf>/<id>` takes a closed key set, and a
 * name/description/content edit needs `If-Match`. Both refusals — and the
 * custom-HTML capability gate on create — answer before any storage call,
 * which is what keeps these tests storage-free. The storage half (ownership,
 * guard, atomic revision, language merge) is
 * tests/pg/slide-library-save-contract.pgtest.js.
 *
 * Run with: node --test tests/slide-library-save-route.test.js
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

function call(method, path, body, headers = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = headers;
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
  const path = `/api/slide-library/${shelf}/${ITEM_ID}`;

  for (const key of ['i18n', 'favorites', 'slideType', 'themeId', 'shelf']) {
    test(`${shelf} PATCH: '${key}' is not a patch key (400 invalid, key named)`, async () => {
      const { ctx, res } = call(
        'PATCH',
        path,
        { [key]: {} },
        { 'if-match': '0' },
      );
      assert.equal(await handleSlideLibrary(ctx), true);
      assert.equal(res.statusCode, 400);
      assert.equal(res.payload.error, 'invalid');
      assert.deepEqual(res.payload.details, { field: 'body' });
      assert.match(res.payload.message, new RegExp(`"${key}"`));
    });
  }

  test(`${shelf} PATCH: a value of the wrong shape names its field`, async () => {
    const { ctx, res } = call(
      'PATCH',
      path,
      { content: [] },
      { 'if-match': '0' },
    );
    await handleSlideLibrary(ctx);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload.details, { field: 'content' });
  });

  for (const key of ['name', 'description', 'content']) {
    test(`${shelf} PATCH: a '${key}' edit without If-Match is 428 missing_if_match`, async () => {
      const value = key === 'content' ? { title: 'x' } : 'x';
      const { ctx, res } = call('PATCH', path, { [key]: value });
      assert.equal(await handleSlideLibrary(ctx), true);
      assert.equal(res.statusCode, 428);
      assert.equal(res.payload.error, 'missing_if_match');
    });
  }

  test(`${shelf} POST: custom-HTML markup without the capability is refused`, async () => {
    const { ctx, res } = call('POST', `/api/slide-library/${shelf}`, {
      name: 'Raw',
      slideType: 'custom-html-slide',
      content: { html: '<b>hi</b>' },
    });
    assert.equal(await handleSlideLibrary(ctx), true);
    assert.equal(res.statusCode, 403);
    assert.match(res.payload.message, /canEditCustomHtml/);
  });

  test(`${shelf} POST: markup hidden in a language version is refused too`, async () => {
    const { ctx, res } = call('POST', `/api/slide-library/${shelf}`, {
      name: 'Raw',
      slideType: 'custom-html-slide',
      content: {},
      i18n: {
        dominant: 'nl',
        versions: { 'en-GB': { content: { css: 'body{}' } } },
      },
    });
    await handleSlideLibrary(ctx);
    assert.equal(res.statusCode, 403);
  });
}
