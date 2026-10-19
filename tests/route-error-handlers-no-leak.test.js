/**
 * The two route-level catch-all handlers do not leak internal error text
 * (B100).
 *
 * `handleExportError()` and `handleNotionError()` pass an `AppError` through
 * (status, code and message are the contract) and answer anything else with a fixed
 * 500 envelope — a renderer crash or a missing binary carries absolute paths in
 * its message (js/stack-trace-exposure). Also pins that the Notion routes share
 * the one handler instead of inlining copies of it.
 *
 * Run with: node --test tests/route-error-handlers-no-leak.test.js
 */

import { test } from 'node:test';
import { createMockRes } from './helpers/http-mocks.js';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleExportError } from '../server/export/pipeline.js';
import { handleNotionError } from '../server/routes/api/notion/utils.js';
import { AppError, ValidationError } from '../server/utils/errors.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const INTERNAL = new Error('ENOENT: /srv/deckyard/server/export/chromium');

test('handleExportError: AppError passes through, anything else is a fixed 500', () => {
  const ok = createMockRes();
  handleExportError(ok, new ValidationError('Unknown slide'));
  assert.equal(ok.statusCode, 400);
  assert.equal(ok.json().message, 'Unknown slide');

  const crash = createMockRes();
  handleExportError(crash, INTERNAL);
  assert.equal(crash.statusCode, 500);
  assert.equal(crash.json().error, 'export_failed');
  assert.ok(!JSON.stringify(crash.json()).includes('/srv/'));
});

test('handleNotionError: an AppError answers as it is, internal errors do not leak', () => {
  // The seam already decided what a Notion refusal means (B416); the handler
  // does not re-read its wording.
  const gateway = createMockRes();
  handleNotionError(
    new AppError('Notion could not complete this request', 502),
    gateway,
  );
  assert.equal(gateway.statusCode, 502);
  assert.equal(gateway.json().error, 'bad_gateway');
  assert.equal(
    gateway.json().message,
    'Notion could not complete this request',
  );

  const invalid = createMockRes();
  handleNotionError(new ValidationError('Invalid Notion page ID'), invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error, 'bad_request');

  const crash = createMockRes();
  handleNotionError(INTERNAL, crash);
  assert.equal(crash.statusCode, 500);
  assert.equal(crash.json().error, 'notion_error');
  assert.ok(!JSON.stringify(crash.json()).includes('/srv/'));
});

test('the Notion routes use the one handler, no inlined copies', () => {
  for (const f of ['fetch.js', 'import.js']) {
    const src = readFileSync(
      path.join(repoRoot, 'server/routes/api/notion', f),
      'utf8',
    );
    assert.ok(src.includes('handleNotionError(e, res)'), `${f} delegates`);
    assert.ok(
      !src.includes("'notion_error'"),
      `${f} has no inline notion_error envelope`,
    );
  }
});
