/**
 * C7a gate — the internal error surface has no envelope stragglers left.
 *
 * Two things are pinned here:
 *
 * 1. No route under `server/routes/api/` (and not `server/server.js`) answers
 *    an error with `serveJson(res, 4xx/5xx, …)` — errors go through
 *    `jsonError()`/the status helpers so every failure carries the canonical
 *    `{ ok: false, error: '<machine_code>' }` envelope. The public
 *    `/api/v1/*` surface (`server/routes/public-api/`) keeps its own
 *    openapi-documented shape and is exempt.
 *
 * 2. The top-level throttle in `server.js` uses `rateLimited()` — the old
 *    handwritten 429 (`{ error: 'Rate limit exceeded' }`) must not come back.
 *    The envelope `rateLimited()` produces is pinned in
 *    `tests/api-error-envelope.test.js`.
 *
 * Run with: node --test tests/error-envelope-stragglers-guard.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getErrorStatus } from '../server/utils/http.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Recursively collect .js files under a directory. */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const ERROR_STATUS_SERVE = /serveJson\(\s*res\s*,\s*[45]\d\d\b/;

test('no serveJson with a 4xx/5xx literal status in internal api routes', () => {
  const offenders = [];
  for (const file of jsFiles(path.join(repoRoot, 'server/routes/api'))) {
    const src = readFileSync(file, 'utf8');
    if (ERROR_STATUS_SERVE.test(src)) offenders.push(path.relative(repoRoot, file));
  }
  assert.deepEqual(
    offenders,
    [],
    `Error responses must use jsonError()/status helpers (canonical envelope), not serveJson: ${offenders.join(', ')}`
  );
});

test('server.js throttles through rateLimited(), not a handwritten 429', () => {
  const src = readFileSync(path.join(repoRoot, 'server/server.js'), 'utf8');
  assert.match(src, /\brateLimited\(res\)/, 'server.js must answer throttled requests via rateLimited()');
  assert.doesNotMatch(src, /writeHead\(\s*429/, 'no handwritten 429 response in server.js');
  assert.doesNotMatch(src, /Rate limit exceeded/, 'the pre-envelope 429 body must not come back');
});

test('comment failure reasons map to the intended statuses', () => {
  // Server-side failures must not blame the caller.
  assert.equal(getErrorStatus('unavailable'), 503);
  // A missing row on update is a 404, not a generic 400.
  assert.equal(getErrorStatus('not_found'), 404);
  // Caller-side reasons stay 400 via the default.
  assert.equal(getErrorStatus('invalid'), 400);
  assert.equal(getErrorStatus('invalid_presentation'), 400);
  assert.equal(getErrorStatus('parent_not_found'), 400);
  assert.equal(getErrorStatus('not_found_or_already_resolved'), 400);
  assert.equal(getErrorStatus('not_found_or_not_resolved'), 400);
  assert.equal(getErrorStatus('not_found_or_already_handled'), 400);
});
