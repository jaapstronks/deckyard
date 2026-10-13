/** Run with: node --test tests/test-helpers.test.js */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMockReq, createMockRes } from './helpers/http-mocks.js';
import { walkFiles } from './helpers/walk-files.js';
import { createFakeDb } from './helpers/fake-db.js';

test('HTTP doubles stream JSON and retain raw non-JSON response bytes', async () => {
  const req = createMockReq({
    method: 'PUT',
    headers: { 'x-test': 'yes' },
    body: { title: 'Hi' },
  });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  assert.deepEqual(JSON.parse(Buffer.concat(chunks)), { title: 'Hi' });
  assert.equal(req.method, 'PUT');
  assert.equal(req.headers['x-test'], 'yes');
  const res = createMockRes();
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(Buffer.from('{"id":1}'));
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.headers, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(res.json(), { id: 1 });
  const binary = Buffer.from([0, 255]);
  res.end(binary);
  assert.equal(res.body, binary);
  assert.throws(() => res.json(), SyntaxError);
  assert.equal(createMockRes().json(), null);
  assert.notEqual(createMockRes().headers, createMockRes().headers);
});

test('walker preserves extension/skip filters, ignores symlinks and throws on missing roots by default', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'deckyard-test-walk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'nested'));
  mkdirSync(path.join(root, 'vendor'));
  for (const file of ['a.js', 'a.css', 'nested/b.js', 'vendor/c.js'])
    writeFileSync(path.join(root, file), '');
  symlinkSync(root, path.join(root, 'nested', 'cycle'));
  const relative = (files) =>
    files.map((file) => path.relative(root, file)).sort();
  assert.deepEqual(
    relative(walkFiles(root, { extensions: ['.js'], skipDirs: ['vendor'] })),
    ['a.js', 'nested/b.js'],
  );
  assert.equal(walkFiles(root).length, 4);
  assert.throws(() => walkFiles(path.join(root, 'missing')), {
    code: 'ENOENT',
  });
  assert.deepEqual(
    walkFiles(path.join(root, 'missing'), { missingOk: true }),
    [],
  );
  assert.throws(() => walkFiles(path.join(root, 'a.js'), { missingOk: true }), {
    code: 'ENOTDIR',
  });
});

test('callback joins fail explicitly rather than pairing every user with the first settings row', async () => {
  const db = createFakeDb({
    users: [{ id: 'alice' }, { id: 'bob' }, { id: 'carol' }],
    user_settings: [
      { user_id: 'bob', settings: 'bob-settings' },
      { user_id: 'alice', settings: 'alice-settings' },
    ],
  });
  const query = db.selectFrom('users');
  const callback = (join) =>
    join.onRef('user_settings.user_id', '=', 'users.id');
  for (const method of ['leftJoin', 'innerJoin']) {
    assert.throws(
      () => query[method]('user_settings', callback),
      /fake-db: only column-reference joins are supported; callback joins require PostgreSQL/,
    );
  }
  // Rejected joins did not mutate the query. The supported reference form
  // still selects the right partner and retains the unmatched left row.
  const rows = await query
    .leftJoin('user_settings', 'user_settings.user_id', 'users.id')
    .select(['users.id', 'user_settings.settings'])
    .execute();
  assert.deepEqual(rows, [
    { id: 'alice', settings: 'alice-settings' },
    { id: 'bob', settings: 'bob-settings' },
    { id: 'carol', settings: undefined },
  ]);
});
