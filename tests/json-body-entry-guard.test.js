import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A7.19 C6 — one JSON body entry point.
 *
 * The server used to have four readers for the same thing (`json`,
 * `parseJsonBody`, `requireJsonBody`, `readRequestBody`) with four different
 * answers to "empty body" and "broken body". `requireJsonBody` is now the only
 * one route handlers use; `readRequestBody` stays as the byte-level layer under
 * it and for the one body that is not JSON (the `.deck` bundle upload).
 *
 * This guard keeps a second reader from growing back.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('http.js exports exactly one JSON body entry point', async () => {
  const src = await fs.readFile(path.join(REPO_ROOT, 'server/utils/http.js'), 'utf8');
  const exported = [...src.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);

  assert.ok(exported.includes('requireJsonBody'), 'requireJsonBody is the entry point');
  assert.ok(
    !exported.includes('json'),
    'the throwing `json()` reader is gone — it left the 400 to the call site'
  );
  assert.ok(
    !exported.includes('parseJsonBody'),
    'the `{ok, error}` reader is gone — its callers decided the status themselves'
  );
});

test('no route handler reads a request body except through requireJsonBody', async () => {
  const files = await walk(path.join(REPO_ROOT, 'server/routes'));
  const offenders = [];

  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    for (const [i, line] of src.split('\n').entries()) {
      if (/\bjson\(req\b/.test(line) || /\bparseJsonBody\(/.test(line)) {
        offenders.push(`${rel}:${i + 1}`);
      }
      // `readRequestBody` is the byte layer. Reading it directly is only right
      // for a body that is not JSON — today just the `.deck` bundle upload.
      if (
        /\breadRequestBody\(/.test(line) &&
        !rel.endsWith('presentations/import-deck.js') &&
        !rel.endsWith('public-api/v1/middleware.js')
      ) {
        offenders.push(`${rel}:${i + 1} (readRequestBody)`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `route handlers must use requireJsonBody (or readApiV1Body on /api/v1):\n${offenders.join('\n')}`
  );
});
