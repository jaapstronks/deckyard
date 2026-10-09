/**
 * One error code, one meaning (D122, B215).
 *
 * `locked` used to be two things on the wire: the 423 slide lock
 * (`LockedError`, with `{ slideId, lockKind, holder }`) and a 409 storage
 * reason for a promoted question. A client branching on `error === 'locked'`
 * could not tell which. The promoted question now answers `closed`, the code
 * a closed vote or session already had, and `locked` is the slide lock only.
 *
 * The general form pinned here: a code that is both a status-default name
 * (`codeForStatus`) and a storage reason answers the same status from both
 * families, so the status always follows from `REASONS`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { REASONS, isReason } from '../server/storage/reasons.js';
import { codeForStatus, LockedError } from '../server/utils/errors.js';
import { PAYLOAD_KEYS } from '../server/utils/error-details.js';

test('`locked` is the 423 slide lock, never a storage reason', () => {
  assert.equal(isReason('locked'), false);
  const err = new LockedError('held by someone', {
    slideId: 's1',
    lockKind: 'concurrent',
  });
  assert.equal(err.statusCode, 423);
  assert.equal(err.code, 'locked');
  assert.deepEqual(PAYLOAD_KEYS.locked, ['slideId', 'lockKind', 'holder']);
});

test('a promoted question refuses with `closed`, not `locked`', () => {
  const src = fs.readFileSync(
    new URL('../server/storage/questions.js', import.meta.url),
    'utf8',
  );
  const guards = src.match(
    /q\.status === 'promoted'\) return \{ ok: false[^}]*\}/g,
  );
  assert.equal(guards?.length, 3, 'upvote, cancel and remove guard promoted');
  for (const g of guards) assert.match(g, /reason: 'closed'/);
  assert.equal(REASONS.closed.status, 409);
});

test('a code shared by both families answers one status', () => {
  const statuses = [400, 401, 403, 404, 409, 413, 422, 423, 429, 500, 502, 503];
  for (const status of statuses) {
    const code = codeForStatus(status);
    if (!isReason(code)) continue;
    assert.equal(
      REASONS[code].status,
      status,
      `${code} is ${status} as an AppError but ${REASONS[code].status} as a reason`,
    );
  }
});
