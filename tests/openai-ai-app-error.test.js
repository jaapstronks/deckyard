/**
 * C7f — the openai/* and ai/* trees throw AppError, not bare Error + `.statusCode =`.
 *
 * Pins per converted tree that the statuses are unchanged (the conversion is
 * behavior-preserving), that raw LLM responses stay out of the serialized
 * envelope (they ride along as the `response` instance field for logging —
 * the same hazard C7b closed for alt-text), that "unsupported vendor" has
 * exactly one form (`LlmError.unsupportedVendor`), and gates the bare-Error
 * idiom out of both trees.
 *
 * Run with: node --test tests/openai-ai-app-error.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertSlideWithAi } from '../server/utils/openai/convert-slide.js';
import { translateShortText } from '../server/utils/openai/translate.js';
import { LlmError } from '../server/utils/llm/error.js';
import { ValidationError, isAppError } from '../server/utils/errors.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isValidationError = (err) =>
  err instanceof ValidationError && err.statusCode === 400 && isAppError(err);

test('convert-slide input validation throws 400 ValidationError', async () => {
  await assert.rejects(() => convertSlideWithAi({}, 'list-slide'), isValidationError);
  await assert.rejects(
    () => convertSlideWithAi({ type: 'content-slide' }, 'no-such-type'),
    isValidationError
  );
});

test('translate language-pair validation throws 400 ValidationError', async () => {
  await assert.rejects(() => translateShortText('x', { from: 'nl', to: 'nl' }), isValidationError);
  await assert.rejects(() => translateShortText('x', { from: 'xx', to: 'nl' }), isValidationError);
});

test('raw LLM content stays out of the envelope for upstream failures', () => {
  // The shape every converted 5xx site throws (append/deck/translate/
  // convert-slide/refine-section): raw content as `response`, never `details`.
  const err = new LlmError('openai did not return valid deck JSON.', {
    statusCode: 502,
    vendor: 'openai',
    response: 'raw model output that must never leave the server',
    phase: 'deck',
  });
  assert.ok(isAppError(err));
  assert.equal(err.statusCode, 502);
  assert.deepEqual(err.toJSON(), {
    ok: false,
    error: 'internal_error',
    message: 'openai did not return valid deck JSON.',
  });
  assert.equal(err.response, 'raw model output that must never leave the server');
});

test('"unsupported vendor" has exactly one form: LlmError.unsupportedVendor', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js') && readFileSync(full, 'utf8').includes('Unsupported LLM vendor')) {
        offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, 'server'));
  assert.deepEqual(offenders, ['server/utils/llm/error.js']);
});

test('no bare .statusCode assignment left under openai/ and ai/', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js') && /\.statusCode = /.test(readFileSync(full, 'utf8'))) {
        offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, 'server/utils/openai'));
  walk(path.join(repoRoot, 'server/utils/ai'));
  assert.deepEqual(offenders, [], `These modules must throw AppError subclasses: ${offenders.join(', ')}`);
});
