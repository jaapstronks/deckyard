/**
 * `storageError` puts the location of a refused input on the wire (B202).
 *
 * `details.field` said which input was bad; when that input is a list the
 * storage layer inspected entry by entry, the sentence in `message` named the
 * row ("Rows" › "Kind" …) but a client had to parse it to point at the row.
 * Now `details` carries `index`, `itemIndex` and `reason` next to `field` —
 * the shape docs/reference/api-error-format.md § details documents — and
 * carries nothing else from the storage result (no `where`, no prose).
 *
 * Run with: node --test tests/storage-error-details.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { storageError } from '../server/utils/http.js';

/** Minimal ServerResponse stand-in that records status and body. */
class MockRes {
  constructor() {
    this.statusCode = null;
    this.chunks = [];
  }
  writeHead(status) {
    this.statusCode = status;
    return this;
  }
  end(chunk) {
    if (chunk != null) this.chunks.push(Buffer.from(chunk));
  }
  body() {
    return JSON.parse(Buffer.concat(this.chunks).toString('utf8'));
  }
}

test('a field-level refusal carries just the field', () => {
  const res = new MockRes();
  storageError(res, { reason: 'invalid', field: 'slug' }, 'Invalid slug.');
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body(), {
    ok: false,
    error: 'invalid',
    message: 'Invalid slug.',
    details: { field: 'slug' },
  });
});

test('a located problem adds index, itemIndex and reason — and nothing else', () => {
  const res = new MockRes();
  storageError(
    res,
    {
      reason: 'invalid',
      field: 'fields',
      fieldProblem: {
        reason: 'enum_without_options',
        index: 0,
        itemIndex: 1,
        where: '"Rows" › "Kind"',
      },
    },
    '"Rows" › "Kind" is a dropdown with no options.',
  );
  assert.deepEqual(res.body().details, {
    field: 'fields',
    index: 0,
    itemIndex: 1,
    reason: 'enum_without_options',
  });
});

test('a null index is omitted rather than sent as null', () => {
  const res = new MockRes();
  storageError(
    res,
    {
      reason: 'invalid',
      field: 'fields',
      fieldProblem: { reason: 'not_an_array', index: null, itemIndex: null },
    },
    'Fields must be a list.',
  );
  assert.deepEqual(res.body().details, {
    field: 'fields',
    reason: 'not_an_array',
  });
});

test('a result that names no field sends no details', () => {
  const res = new MockRes();
  storageError(res, { reason: 'not_found' }, 'No such slide type.');
  assert.equal(res.statusCode, 404);
  assert.equal('details' in res.body(), false);
});
