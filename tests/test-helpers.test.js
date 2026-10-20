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
import {
  createMockEventStreamRes,
  createMockStreamRes,
  createMockReq,
  createMockRes,
  createMockLifecycleRes,
} from './helpers/http-mocks.js';
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

test('response lifecycle commits headers separately from completion', () => {
  const res = createMockLifecycleRes();
  assert.equal(res.headersSent, false);
  assert.equal(res.writableEnded, false);
  assert.equal(res.ended, false);
  res.setHeader('X-Test', 'yes');
  assert.equal(res.headersSent, false);
  res.writeHead(202, { 'Content-Type': 'text/plain' });
  assert.equal(res.headersSent, true);
  assert.equal(res.writableEnded, false);
  assert.equal(res.ended, false);
  const bytes = Buffer.from([0, 255]);
  res.end(bytes);
  assert.equal(res.body, bytes);
  assert.equal(res.ended, true);
  assert.equal(res.writableEnded, true);
  const direct = createMockLifecycleRes();
  direct.end();
  assert.equal(direct.headersSent, true);
  assert.equal(direct.writableEnded, true);
});

test('plain capture tracks end without inventing header or stream flags', () => {
  const res = createMockRes();
  res.writeHead(200);
  assert.equal(res.ended, false);
  assert.equal(res.headersSent, undefined);
  assert.equal(res.writableEnded, undefined);
  res.end('done');
  assert.equal(res.ended, true);
});

test('stream capture keeps binary chunks and end bytes in order without early UTF-8 decoding', () => {
  const res = createMockStreamRes();
  assert.equal(res.statusCode, null);
  assert.equal(res.headersSent, false);
  assert.equal(res.writableEnded, false);
  assert.equal(res.json(), null);
  assert.deepEqual(res.body, Buffer.alloc(0));
  res.setHeader('X-Test', 'stream');
  res.writeHead(202, { 'Content-Type': 'application/octet-stream' });
  assert.equal(res.write(Buffer.from([0, 255, 0xe2])), true);
  assert.deepEqual(res.body, Buffer.from([0, 255, 0xe2]));
  assert.equal(res.writableEnded, false);
  assert.equal(res.end(Buffer.from([0x82, 0xac])), res);
  assert.deepEqual(res.body, Buffer.from([0, 255, 0xe2, 0x82, 0xac]));
  assert.equal(res.chunks.length, 2);
  assert.equal(res.statusCode, 202);
  assert.equal(res.headers['X-Test'], 'stream');
  assert.equal(res.headersSent, true);
  assert.equal(res.writableEnded, true);
  assert.equal(res.ended, true);
  assert.throws(() => res.json(), SyntaxError);
  const json = createMockStreamRes();
  json.write('{"text":"');
  json.write(Buffer.from([0xe2]));
  json.end(Buffer.from([0x82, 0xac, 0x22, 0x7d]));
  assert.deepEqual(json.json(), { text: '€' });
  assert.equal(json.statusCode, 200);
  assert.deepEqual(json.body, Buffer.from('{"text":"€"}'));
  const empty = createMockStreamRes();
  empty.end();
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.writableEnded, true);
  assert.equal(empty.json(), null);
  assert.deepEqual(empty.chunks, []);
});

test('headers append repeated cookies and replace them case-insensitively', () => {
  const res = createMockRes();
  res.setHeader('Set-Cookie', 'state=one');
  res.appendHeader('set-cookie', 'session=two');
  res.appendHeader('SET-COOKIE', ['third=three', 'fourth=four']);
  assert.deepEqual(res.getHeader('set-cookie'), [
    'state=one',
    'session=two',
    'third=three',
    'fourth=four',
  ]);
  res.setHeader('set-cookie', ['replacement=yes']);
  assert.deepEqual(res.getHeader('Set-Cookie'), ['replacement=yes']);
  assert.equal(Object.keys(res.headers).length, 1);
  res.appendHeader('X-New', 'first');
  assert.equal(res.getHeader('x-new'), 'first');
});

test('event stream records raw writes, flushes headers and rejects write after end', () => {
  const res = createMockEventStreamRes();
  const events = [];
  res.on('close', () => events.push('close'));
  res.on('finish', () => events.push('finish'));
  assert.equal(res.writable, true);
  assert.equal(res.writableFinished, false);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.flushHeaders();
  assert.equal(res.flushed, true);
  assert.equal(res.writableEnded, false);
  res.write('event: status\n');
  res.end('data: {}\n\n');
  assert.equal(res.body.toString(), 'event: status\ndata: {}\n\n');
  assert.equal(res.chunks.length, 2);
  assert.equal(res.writable, false);
  assert.equal(res.writableEnded, true);
  assert.equal(res.writableFinished, true);
  assert.throws(() => res.write('too late'), /ERR_STREAM_WRITE_AFTER_END/);
  assert.equal(res.chunks.length, 2);
  assert.deepEqual(events, [], 'tests control the socket event boundaries');
  res.emit('finish');
  res.emit('close');
  assert.deepEqual(events, ['finish', 'close']);
});
