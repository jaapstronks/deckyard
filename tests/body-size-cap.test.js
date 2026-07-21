import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  json,
  parseJsonBody,
  readRequestBody,
  maxRequestBodyBytes,
} from '../server/utils/http.js';

/**
 * Security hardening 5a: request bodies must be size-capped so an authenticated
 * client can't OOM the server with an unbounded body.
 */

function reqFrom(str) {
  // A Readable is async-iterable, matching how http.js consumes `req`.
  return Readable.from([Buffer.from(str)]);
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

test('json parses a body under the cap', () => {
  return withEnv('1000', async () => {
    const body = await json(reqFrom(JSON.stringify({ a: 1 })));
    assert.deepEqual(body, { a: 1 });
  });
});

test('json throws 413 when the body exceeds the cap', () => {
  return withEnv('16', async () => {
    await assert.rejects(
      () => json(reqFrom(JSON.stringify({ big: 'x'.repeat(100) }))),
      (e) => e.statusCode === 413
    );
  });
});

test('readRequestBody throws 413 over the cap', () => {
  return withEnv('8', async () => {
    await assert.rejects(
      () => readRequestBody(reqFrom('0123456789')),
      (e) => e.statusCode === 413
    );
  });
});

test('parseJsonBody returns ok:false with statusCode 413 when too large', () => {
  return withEnv('8', async () => {
    const res = await parseJsonBody(reqFrom('0123456789'));
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 413);
  });
});
