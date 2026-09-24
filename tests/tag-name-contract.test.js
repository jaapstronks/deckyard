/**
 * B370 — a tag name the column cannot carry is a 400 that names the field.
 *
 * Three inputs used to leave the API in three different states, none of them a
 * usable answer:
 *
 *   - a name with a **NUL byte** reached PostgreSQL and came back as a 500
 *     (`22021`, "invalid byte sequence for encoding UTF8");
 *   - two names that differ in JavaScript but fold together in the database's
 *     `lower()` (`'İ'` and `'i'`) were written as two tags and violated
 *     `idx_tags_org_name` — a second 500;
 *   - a **blank or over-long** name was silently dropped, so the request
 *     answered 200 with the name gone and nothing said about it.
 *
 * What a tag may be called is one contract now (`shared/tag-name.js`), enforced
 * once in storage and answered in the layer's one refusal shape: `400 invalid`
 * with `details.field`, plus `details.index` when the name came out of a list
 * and `details.reason` naming the problem. These tests drive the real route
 * handler for the one surface whose refusal lands before any query, so they
 * need no database. The deck and library-shelf routes authorize their row
 * first (B436; D184 leaves the selection with the caller), so their refusal
 * needs a real row: the library case and the fold case live in
 * tests/pg/tag-name-contract.pgtest.js, the deck route's refusal in
 * tests/pg/presentation-tags-authz.pgtest.js.
 *
 * Run with: node --test tests/tag-name-contract.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { handleTags } from '../server/routes/api/tags.js';
import { testScope } from './helpers/storage-scope.js';

// A test is the session, so it states the organization it acts in; the
// refusals below land before any query, so no database is involved.
const storageScope = testScope();

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

function jsonReq(method, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.headers = {};
  return req;
}

/** A literal NUL, built rather than typed: it is invisible in a source file. */
const NUL = String.fromCharCode(0);

/** The three names the contract refuses, and the sub-code each one earns. */
const REFUSED = [
  { label: 'a NUL byte', name: `bad${NUL}name`, reason: 'control_character' },
  { label: 'a blank name', name: '   ', reason: 'blank' },
  { label: 'an over-long name', name: 'x'.repeat(101), reason: 'too_long' },
];

for (const { label, name, reason } of REFUSED) {
  test(`POST /api/tags: ${label} is a 400 naming the field`, async () => {
    const res = mockRes();
    await handleTags({
      storageScope,
      req: jsonReq('POST', { name }),
      res,
      url: { pathname: '/api/tags', searchParams: new URLSearchParams() },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.payload.error, 'invalid');
    assert.equal(res.payload.details.field, 'name');
    assert.equal(
      res.payload.details.index,
      undefined,
      'a single name has nowhere to point',
    );
    assert.equal(res.payload.details.reason, reason);
  });
}

test('POST /api/tags: a missing name is refused as a blank one', async () => {
  const res = mockRes();
  await handleTags({
    storageScope,
    req: jsonReq('POST', {}),
    res,
    url: { pathname: '/api/tags', searchParams: new URLSearchParams() },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'invalid');
  assert.equal(res.payload.details.field, 'name');
  assert.equal(res.payload.details.reason, 'blank');
});
