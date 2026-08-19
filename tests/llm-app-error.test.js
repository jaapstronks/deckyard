/**
 * C7b — the LLM tree throws AppError, not bare Error + `.statusCode =`.
 *
 * Pins three things:
 *
 * 1. `LlmError` IS an `AppError`: `isAppError()`/`withErrorHandler` recognize
 *    it, and its `toJSON()` is the canonical envelope — the raw provider
 *    `response` and debug context stay instance fields and never reach the
 *    client.
 * 2. The domain errors keep their pre-conversion statuses (400 for caller
 *    mistakes, 502 for upstream LLM failures) — the conversion is
 *    behavior-preserving on status.
 * 3. Source gate: no `.statusCode = ` assignment survives under
 *    `server/utils/llm/` — the bare-Error idiom must not creep back.
 *
 * Run with: node --test tests/llm-app-error.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LlmError } from '../server/utils/llm/error.js';
import { requireEnv } from '../server/utils/llm/env.js';
import {
  AppError,
  ValidationError,
  isAppError,
} from '../server/utils/errors.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

test('LlmError is an AppError with the canonical envelope', () => {
  const err = new LlmError('upstream failed', {
    statusCode: 502,
    vendor: 'openai',
    model: 'gpt-x',
    response: 'raw provider payload that must never leave the server',
    phase: 'outline',
  });

  assert.ok(err instanceof AppError);
  assert.ok(isAppError(err));
  assert.equal(err.statusCode, 502);
  assert.equal(err.name, 'LlmError');

  const body = err.toJSON();
  // B61 mapped 502 → `bad_gateway` in the shared status→code table (it used to
  // fall through to the >=500 `internal_error`); the raw provider payload still
  // never reaches the envelope, which is what this test guards.
  assert.deepEqual(body, {
    ok: false,
    error: 'bad_gateway',
    message: 'upstream failed',
  });
  // Debug fields stay on the instance for logging…
  assert.equal(err.vendor, 'openai');
  assert.equal(
    err.response,
    'raw provider payload that must never leave the server',
  );
  // …but never in the serialized envelope.
  assert.ok(
    !('response' in body) && !('vendor' in body) && !('context' in body),
  );
});

test('LlmError statuses are unchanged by the AppError conversion', () => {
  assert.equal(new LlmError('x').statusCode, 502);
  assert.equal(
    LlmError.fromProviderFailure('openai', 500, 'body').statusCode,
    502,
  );
  assert.equal(LlmError.fromJsonParseFailure('raw').statusCode, 502);
  assert.equal(LlmError.unsupportedVendor('nope').statusCode, 400);
  assert.equal(LlmError.fromProviderFailure('openai', 503, '').retryable, true);
  assert.equal(
    LlmError.fromProviderFailure('openai', 401, '').retryable,
    false,
  );
});

test('requireEnv throws a 400 ValidationError for a missing variable', () => {
  assert.throws(
    () => requireEnv('DEFINITELY_NOT_SET_LLM_VAR'),
    (err) =>
      err instanceof ValidationError &&
      err.statusCode === 400 &&
      isAppError(err),
  );
});

test('no bare .statusCode assignment left under server/utils/llm/', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (
        entry.endsWith('.js') &&
        /\.statusCode = /.test(readFileSync(full, 'utf8'))
      ) {
        offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, 'server/utils/llm'));
  assert.deepEqual(
    offenders,
    [],
    `LLM modules must throw AppError subclasses: ${offenders.join(', ')}`,
  );
});
