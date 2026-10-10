/**
 * A failed background job says why, in display text or not at all (B646).
 *
 * `GET /api/jobs/:id` used to answer `error: <failedReason>` — the raw message
 * of whatever the worker threw (`Unknown export type: …`, an `ENOENT` carrying
 * a server path), untranslated and written for nobody. The envelope spends one
 * field on display text (`docs/reference/api-error-format.md` → `message`), so
 * a job failure is rendered by the rule every contract already follows: an
 * `AppError`'s sentence was written for the caller whatever its status; any
 * other throw is ours and says nothing.
 *
 * Three things are pinned here: the rule, the recording that carries it from
 * worker to route, and that no reader of the raw reason came back.
 *
 * Run with: node --test tests/job-failure-message.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getJobFailureMessage,
  jobFailureMessage,
  withRecordedFailures,
} from '../server/jobs/queue/job-failure.js';
import {
  AppError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../server/utils/errors.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A BullMQ job double: the processor wrap only reads `id`. */
const job = (id) => ({ id });

// ------------------------------------------------------------------ the rule

test('an AppError lends a failed job its sentence', () => {
  assert.equal(
    jobFailureMessage(new NotFoundError('Presentation not found')),
    'Presentation not found',
  );
  assert.equal(
    jobFailureMessage(new ValidationError('A target language is required.')),
    'A target language is required.',
  );
  // Status does not decide it: an AppError's message was written for the
  // caller even at 500 (isInternalFailure, server/utils/errors.js).
  assert.equal(jobFailureMessage(new InternalError()), 'Internal server error');
  assert.equal(
    jobFailureMessage(new AppError('Model refused the deck', 502)),
    'Model refused the deck',
  );
});

test('an unexpected throw leaves no sentence', () => {
  // The two the item names, plus the shapes a library failure arrives in.
  assert.equal(jobFailureMessage(new Error('Unknown export type: pptz')), null);
  const enoent = new Error("ENOENT: no such file '/srv/deckyard/tmp/x.zip'");
  enoent.code = 'ENOENT';
  assert.equal(jobFailureMessage(enoent), null);
  assert.equal(jobFailureMessage(new TypeError('x is not a function')), null);
  assert.equal(jobFailureMessage(undefined), null);
  assert.equal(jobFailureMessage({ message: 42 }), null);
});

// ------------------------------------------------------- worker → status route

test('a worker records what its failure may say, and rethrows it', async () => {
  const thrown = new NotFoundError('Presentation not found');
  const processor = withRecordedFailures('export', async () => {
    throw thrown;
  });

  await assert.rejects(
    () => processor(job('41')),
    (err) => {
      // Untouched: BullMQ's own `failedReason`, its retries and its backoff are
      // the processor's, not the wrap's.
      assert.equal(err, thrown);
      return true;
    },
  );

  assert.equal(getJobFailureMessage('export', '41'), 'Presentation not found');
  // Job ids are per-queue counters, so the record is keyed by both.
  assert.equal(getJobFailureMessage('heavy', '41'), null);
});

test('an unexpected failure records nothing to show', async () => {
  const processor = withRecordedFailures('heavy', async () => {
    throw new Error('ENOSPC: no space left on device');
  });
  await assert.rejects(() => processor(job('42')));
  assert.equal(getJobFailureMessage('heavy', '42'), null);
});

test('a retry that succeeds clears what the failed attempt said', async () => {
  let attempt = 0;
  const processor = withRecordedFailures('translate', async () => {
    attempt += 1;
    if (attempt === 1) throw new NotFoundError('Presentation not found');
    return { ok: true };
  });

  await assert.rejects(() => processor(job('43')));
  assert.equal(
    getJobFailureMessage('translate', '43'),
    'Presentation not found',
  );

  assert.deepEqual(await processor(job('43')), { ok: true });
  assert.equal(getJobFailureMessage('translate', '43'), null);
});

test('a second failure replaces the sentence of the first', async () => {
  const processor = (err) =>
    withRecordedFailures('export', async () => {
      throw err;
    });

  await assert.rejects(() => processor(new NotFoundError('Gone'))(job('44')));
  assert.equal(getJobFailureMessage('export', '44'), 'Gone');

  // An attempt that fails for a reason of ours must not leave the earlier
  // sentence standing as if it still applied.
  await assert.rejects(() => processor(new Error('socket hang up'))(job('44')));
  assert.equal(getJobFailureMessage('export', '44'), null);
});

// ------------------------------------------------- no reader of the raw reason

/** Source with its comments blanked, so prose about the field is not a read. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\/[^\n]*$/gm, '');
}

test("nothing reads a job's failedReason any more", () => {
  const offenders = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const next = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.js')) {
        for (const [i, line] of codeOnly(fs.readFileSync(next, 'utf8'))
          .split('\n')
          .entries()) {
          if (line.includes('failedReason')) {
            offenders.push(`${path.relative(repoRoot, next)}:${i + 1}`);
          }
        }
      }
    }
  };
  for (const dir of ['server', 'client', 'shared']) {
    walk(path.join(repoRoot, dir));
  }
  assert.deepEqual(
    offenders,
    [],
    'the raw reason is a server-side fact; answer `message` instead:\n' +
      offenders.join('\n'),
  );
});
