import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireJsonBody, isJsonObject } from '../server/utils/http.js';

/**
 * A7.19 C6-staartje — the JSON body entry owns "is this a plain object".
 *
 * `requireJsonBody` used to hand `JSON.parse(raw)` back verbatim, so a top-level
 * array or primitive reached the handler and 12 sites across 5 route-files each
 * re-checked `typeof body !== 'object'`. The entry now rejects a non-object body
 * itself (a 400 in the canonical envelope), so a successful result guarantees a
 * plain object and the per-route guards are gone.
 *
 * These tests pin that: the behavioural contract on the entry, and a static
 * guard so a whole-body `typeof body` check does not grow back in a route.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function reqFrom(str) {
  return Readable.from([Buffer.from(str)]);
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(status) {
      this.statusCode = status;
    },
    end(payload) {
      this.body = payload ? JSON.parse(payload) : null;
    },
  };
}

test('isJsonObject accepts a plain object and nothing else', () => {
  assert.equal(isJsonObject({}), true);
  assert.equal(isJsonObject({ a: 1 }), true);
  assert.equal(isJsonObject([]), false, 'an array is not a JSON object');
  assert.equal(isJsonObject(null), false, 'null is typeof "object" but not a body');
  assert.equal(isJsonObject(5), false);
  assert.equal(isJsonObject('x'), false);
  assert.equal(isJsonObject(true), false);
});

test('requireJsonBody accepts a plain object', async () => {
  const res = fakeRes();
  const result = await requireJsonBody(reqFrom(JSON.stringify({ a: 1 })), res);
  assert.equal(result.ok, true);
  assert.deepEqual(result.body, { a: 1 });
  assert.equal(res.statusCode, null);
});

test('requireJsonBody answers 400 on a top-level array', async () => {
  const res = fakeRes();
  const result = await requireJsonBody(reqFrom('[1,2,3]'), res);
  assert.equal(result.ok, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bad_request');
  assert.equal(res.body.message, 'Request body must be a JSON object');
});

test('requireJsonBody answers 400 on a top-level primitive', async () => {
  for (const raw of ['5', '"hello"', 'true', 'null']) {
    const res = fakeRes();
    const result = await requireJsonBody(reqFrom(raw), res);
    assert.equal(result.ok, false, `${raw} must be rejected`);
    assert.equal(res.statusCode, 400, `${raw} must be a 400`);
    assert.equal(res.body.message, 'Request body must be a JSON object');
  }
});

test('allowNonObject lets a top-level array through', async () => {
  const res = fakeRes();
  const result = await requireJsonBody(reqFrom('["a","b"]'), res, { allowNonObject: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.body, ['a', 'b']);
  assert.equal(res.statusCode, null);
});

test('allowEmpty still yields a plain object, not the parsed primitive', async () => {
  const res = fakeRes();
  const result = await requireJsonBody(reqFrom('   '), res, { allowEmpty: true });
  assert.equal(result.ok, true);
  assert.equal(isJsonObject(result.body), true);
});

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no route re-checks the whole body with typeof', async () => {
  const files = await walk(path.join(REPO_ROOT, 'server/routes'));
  const offenders = [];

  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    for (const [i, line] of src.split('\n').entries()) {
      // Whole-body guards only: `typeof body` / `typeof parsed.body`. Nested
      // field checks (`typeof rss === 'object'`) are legitimate and don't match.
      if (/typeof (?:parsed\.)?body\b/.test(line)) {
        offenders.push(`${rel}:${i + 1}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `requireJsonBody guarantees a plain object; drop the per-route re-check:\n${offenders.join('\n')}`
  );
});
