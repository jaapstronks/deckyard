/**
 * B100 — the two route-level catch-all handlers do not leak internal error text.
 *
 * `handleExportError()` and `handleNotionError()` pass an `AppError` through
 * (status + message are the contract) and answer anything else with a fixed
 * 500 envelope — a renderer crash or a missing binary carries absolute paths in
 * its message (js/stack-trace-exposure). Also pins that the Notion routes share
 * the one handler instead of inlining copies of it.
 *
 * Run with: node --test tests/route-error-handlers-no-leak.test.js
 */

import { test } from 'node:test';
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

function fakeRes() {
  const res = { status: 0, body: null };
  res.writeHead = (status) => {
    res.status = status;
  };
  res.end = (body) => {
    res.body = JSON.parse(body);
  };
  return res;
}

const INTERNAL = new Error('ENOENT: /srv/deckyard/server/export/chromium');

test('handleExportError: AppError passes through, anything else is a fixed 500', () => {
  const ok = fakeRes();
  handleExportError(ok, new ValidationError('Unknown slide'));
  assert.equal(ok.status, 400);
  assert.equal(ok.body.message, 'Unknown slide');

  const crash = fakeRes();
  handleExportError(crash, INTERNAL);
  assert.equal(crash.status, 500);
  assert.equal(crash.body.error, 'export_failed');
  assert.ok(!JSON.stringify(crash.body).includes('/srv/'));
});

test('handleNotionError: upstream AppError keeps its status, internal errors do not leak', () => {
  const upstream = fakeRes();
  handleNotionError(new AppError('rate limited by Notion', 429), upstream);
  assert.equal(upstream.status, 429);
  assert.equal(upstream.body.error, 'notion_error');
  assert.equal(upstream.body.message, 'rate limited by Notion');

  const notFound = fakeRes();
  handleNotionError(new AppError('Could not find page', 404), notFound);
  assert.equal(notFound.status, 400);
  assert.match(notFound.body.message, /shared with your Notion integration/);

  const crash = fakeRes();
  handleNotionError(INTERNAL, crash);
  assert.equal(crash.status, 500);
  assert.equal(crash.body.error, 'notion_error');
  assert.ok(!JSON.stringify(crash.body).includes('/srv/'));
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
