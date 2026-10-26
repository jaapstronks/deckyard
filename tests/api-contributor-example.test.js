/** Execute the API guide's published operator recipe against the real storage export. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

test('the published API-key recipe creates a scoped key without logging its secret', () => {
  const guide = readFileSync(
    new URL('../docs/developer/api.md', import.meta.url),
    'utf8',
  );
  const recipe = guide.match(/<<'JS'\n([\s\S]*?)\nJS\n/);
  assert.ok(recipe, 'the guide must publish one runnable Node heredoc');

  // A fresh process preserves the recipe's root-relative imports and process.env.
  // Only the database is substituted; the published source runs unchanged.
  const run = spawnSync(process.execPath, ['--input-type=module'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      TEST_ORGANIZATION_ID: '00000000-0000-4000-8000-00000000000a',
      TEST_OWNER_EMAIL: 'contributor@example.test',
    },
    encoding: 'utf8',
    timeout: 10000,
    input: `
import assert from 'node:assert/strict';
import { createFakeDb } from './tests/helpers/fake-db.js';
import { __setTestDb } from './server/db/client.js';
const db = createFakeDb({});
let closed = false;
db.destroy = async () => { closed = true; };
__setTestDb(db);

// The retired guide call fails before any query, rather than creating a key.
const { createApiKey: createKey } = await import('./server/storage/api-keys.js');
await assert.rejects(createKey({
  name: 'Test Key', ownerEmail: process.env.TEST_OWNER_EMAIL,
  permissions: ['read', 'write', 'export', 'ai'],
}), TypeError);
assert.equal(db.__queryLog.length, 0);

const output = [];
console.log = (...args) => output.push(args);
${recipe[1]}

assert.equal(closed, true, 'the recipe closes its database connection');
const rows = db.__tables.api_keys;
assert.equal(rows.length, 1);
assert.equal(rows[0].organization_id, process.env.TEST_ORGANIZATION_ID);
assert.equal(rows[0].owner_email, process.env.TEST_OWNER_EMAIL);
assert.equal(rows[0].name, 'Test Key');
assert.deepEqual(JSON.parse(rows[0].permissions), ['read', 'write', 'export', 'ai']);
assert.match(rows[0].key_hash, /^[a-f0-9]{64}$/);
assert.equal(Object.hasOwn(rows[0], 'key'), false);
assert.deepEqual(output[0], [{ id: rows[0].id, name: 'Test Key' }]);
assert.equal(JSON.stringify(output).includes('dk_live_'), false);
`,
  });
  assert.ifError(run.error);
  // Never echo child output on failure: a broken recipe may have logged a key.
  assert.equal(run.status, 0, 'published recipe or storage assertions failed');
  assert.equal(run.stdout.includes('dk_live_'), false, 'stdout exposed a key');
  assert.equal(run.stderr.includes('dk_live_'), false, 'stderr exposed a key');
});
