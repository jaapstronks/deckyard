import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  requireJsonBody,
  readRequestBody,
  maxRequestBodyBytes,
} from '../server/utils/http.js';

/**
 * Security hardening 5a: request bodies must be size-capped so an authenticated
 * client can't OOM the server with an unbounded body.
 *
 * A7.19 C6: `requireJsonBody` is the single JSON body entry point, so the cap
 * and the 400/413 contract are asserted on it rather than on the three readers
 * it replaced.
 */

function reqFrom(str) {
  // A Readable is async-iterable, matching how http.js consumes `req`.
  return Readable.from([Buffer.from(str)]);
}

/** Minimal ServerResponse stand-in that records what the helper sent. */
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

function withEnv(value, fn) {
  const saved = process.env.MAX_REQUEST_BODY_BYTES;
  if (value === undefined) delete process.env.MAX_REQUEST_BODY_BYTES;
  else process.env.MAX_REQUEST_BODY_BYTES = value;
  return Promise.resolve(fn()).finally(() => {
    if (saved === undefined) delete process.env.MAX_REQUEST_BODY_BYTES;
    else process.env.MAX_REQUEST_BODY_BYTES = saved;
  });
}

test('maxRequestBodyBytes honors the env override', () => {
  return withEnv('123', () => assert.equal(maxRequestBodyBytes(), 123));
});

test('readRequestBody throws 413 over the cap', () => {
  return withEnv('8', async () => {
    await assert.rejects(
      () => readRequestBody(reqFrom('0123456789')),
      (e) => e.statusCode === 413,
    );
  });
});

test('requireJsonBody parses a body under the cap', () => {
  return withEnv('1000', async () => {
    const res = fakeRes();
    const result = await requireJsonBody(
      reqFrom(JSON.stringify({ a: 1 })),
      res,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.body, { a: 1 });
    assert.equal(res.statusCode, null, 'nothing was sent on the happy path');
  });
});

test('requireJsonBody answers 413 in the canonical envelope when over the cap', () => {
  return withEnv('8', async () => {
    const res = fakeRes();
    const result = await requireJsonBody(reqFrom('0123456789'), res);
    assert.equal(result.ok, false);
    assert.equal(res.statusCode, 413);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error, 'payload_too_large');
  });
});

test('requireJsonBody answers 400 on an empty body', async () => {
  const res = fakeRes();
  const result = await requireJsonBody(reqFrom(''), res);
  assert.equal(result.ok, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_request');
  assert.equal(res.body.message, 'Request body is required');
});

test('requireJsonBody answers 400 on unparseable JSON', async () => {
  const res = fakeRes();
  const result = await requireJsonBody(reqFrom('{nope'), res);
  assert.equal(result.ok, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid JSON body');
});

test('allowEmpty turns an absent body into {} instead of a 400', async () => {
  const res = fakeRes();
  const result = await requireJsonBody(reqFrom('   '), res, {
    allowEmpty: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.body, {});
  assert.equal(res.statusCode, null);
});

test('allowEmpty still rejects a broken body — absent is not the same as malformed', async () => {
  const res = fakeRes();
  const result = await requireJsonBody(reqFrom('{nope'), res, {
    allowEmpty: true,
  });
  assert.equal(result.ok, false);
  assert.equal(res.statusCode, 400);
});
