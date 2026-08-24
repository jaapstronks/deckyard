/**
 * Guard + unit tests: one `parsePaginationParams`, and it survives garbage
 * input (B143).
 *
 * `server/routes/public-api/v1/middleware.js` used to carry a second function
 * of the same name whose clamp was `Math.min(max, Math.max(1, parseInt(raw)))`
 * — no NaN guard. `?limit=abc` therefore produced `NaN`, which travelled into
 * `filtered.slice(NaN, NaN)` (an empty page) and into the response envelope as
 * `pagination.limit: null`. The shared parser in
 * `server/utils/request-validators.js` falls back to the default instead, and
 * the three v1 call sites now use it.
 *
 * Two halves, both needed: the greptest keeps a third copy from appearing, the
 * unit tests pin the clamping the copies disagreed about.
 *
 * Run with: node --test tests/pagination-params-single-parser.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePaginationParams } from '../server/utils/request-validators.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const OWNER = 'server/utils/request-validators.js';
const DEFINITION = /^\s*export\s+function\s+parsePaginationParams\s*\(/;

/** Every .js file under server/ and shared/, skipping node_modules. */
function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

test('parsePaginationParams is defined exactly once, in request-validators', () => {
  const definers = [];
  for (const file of [
    ...sourceFiles(path.join(repoRoot, 'server')),
    ...sourceFiles(path.join(repoRoot, 'shared')),
  ]) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!DEFINITION.test(line)) return;
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      definers.push(`${rel}:${i + 1}`);
    });
  }

  assert.deepEqual(
    definers.map((d) => d.split(':')[0]),
    [OWNER],
    'pagination parsing belongs to one function; a second copy drifts ' +
      `(found: ${definers.join(', ') || 'none'})`,
  );
});

test('a non-numeric limit falls back to the default instead of NaN', () => {
  const { limit, offset } = parsePaginationParams(
    new URLSearchParams('limit=abc&offset=xyz'),
  );
  assert.equal(limit, 50);
  assert.equal(offset, 0);
});

test('limit and offset are clamped to the documented range', () => {
  // docs/openapi.yaml documents limit as 1-100 (default 50), offset as >= 0.
  assert.equal(
    parsePaginationParams(new URLSearchParams('limit=999')).limit,
    100,
  );
  assert.equal(parsePaginationParams(new URLSearchParams('limit=-5')).limit, 1);
  assert.equal(
    parsePaginationParams(new URLSearchParams('offset=-5')).offset,
    0,
  );
  assert.deepEqual(parsePaginationParams(new URLSearchParams()), {
    limit: 50,
    offset: 0,
  });
});

test('the caller may narrow the defaults and the ceiling', () => {
  const { limit } = parsePaginationParams(new URLSearchParams('limit=abc'), {
    defaultLimit: 20,
    maxLimit: 25,
  });
  assert.equal(limit, 20);
  assert.equal(
    parsePaginationParams(new URLSearchParams('limit=99'), { maxLimit: 25 })
      .limit,
    25,
  );
});
