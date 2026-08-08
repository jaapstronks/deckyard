import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A7.19 C6-restant — `request-validators.js` is the one vocabulary for
 * request-body field validation.
 *
 * The body *entry* is already single (`requireJsonBody`, guarded by
 * `json-body-entry-guard`). What was still scattered were the per-field
 * `typeof body.x === '...'` checks that decided a field's type by hand — 42 of
 * them across the routes, each a private re-spelling of "is this a string /
 * object / boolean / number". They now go through the helpers in
 * `server/utils/request-validators.js` (getString, getOptionalString,
 * getTrimmedString, getOptionalObject, getBoolean, getOptionalBoolean,
 * getDataUrl, getNonNegativeNumber, getStringArray, …).
 *
 * This guard keeps a new one from growing back. `typeof body.<field>` (and
 * `body?.` / `body[`) is the canonical smell: a route reaching into the parsed
 * body to type-check a field inline instead of asking the vocabulary. A
 * whole-body shape guard (`typeof body !== 'object'`, which defends against a
 * top-level JSON primitive/array that `requireJsonBody` still lets through) is
 * deliberately *not* matched — that is not a field check.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// `typeof body` immediately followed by member access: `.field`, `?.field`,
// or `[expr]`. The whole-body `typeof body !== 'object'` form has an operator
// (not member access) after `body`, so it does not match.
const FIELD_TYPEOF = /\btypeof\s+body\s*[?.[]/;

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no route type-checks a request-body field with a bare typeof', async () => {
  const files = await walk(path.join(REPO_ROOT, 'server/routes'));
  const offenders = [];

  for (const file of files) {
    const src = await fs.readFile(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file);
    for (const [i, line] of src.split('\n').entries()) {
      if (FIELD_TYPEOF.test(line)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Validate request-body fields through server/utils/request-validators.js, ' +
      'not a hand-rolled `typeof body.field`:\n' +
      offenders.join('\n')
  );
});

test('the request-validators vocabulary the routes lean on still exists', async () => {
  const src = await fs.readFile(
    path.join(REPO_ROOT, 'server/utils/request-validators.js'),
    'utf8'
  );
  const exported = [...src.matchAll(/^export function (\w+)/gm)].map((m) => m[1]);

  // The forms the C6-restant sweep adopted. If one is removed, its call sites
  // fall back to bare typeof — so the guard above must not be the only thing
  // pinning the vocabulary in place.
  for (const name of [
    'getString',
    'getOptionalString',
    'getTrimmedString',
    'getOptionalObject',
    'getBoolean',
    'getOptionalBoolean',
    'getNonNegativeNumber',
    'getDataUrl',
    'getStringArray',
  ]) {
    assert.ok(exported.includes(name), `request-validators.js must export ${name}`);
  }
});
