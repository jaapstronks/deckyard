import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import {
  parseJson,
  validateRequest,
  validateOutput,
  responseBytes,
  readFrame,
  OUTPUT_LIMIT,
} from '../server/render/renderer-bundle/runner/protocol.js';

const request = () => ({
  schema: 'deckyard.renderer-runner.request/1',
  requestId: 'a_1',
  rendererHash: 'a'.repeat(64),
  input: { schema: 'deckyard.edition-input/1', presentation: { slides: [] } },
});
const bytes = (v) => Buffer.from(JSON.stringify(v));
const frame = (body) => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
};

test('strict JSON refuses duplicate decoded keys, malformed UTF-8, trailing values and excessive depth', () => {
  for (const source of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"nested":{"x":1,"x":2}}',
    '[{"a":0,"a":0}]',
    '{}{}',
    '[1,]',
    '1x',
    '"unterminated',
    '['.repeat(65) + '0' + ']'.repeat(65),
  ])
    assert.throws(() => parseJson(Buffer.from(source)));
  assert.throws(() => parseJson(Buffer.from([0x22, 0xc3, 0x28, 0x22])));
  assert.deepEqual(
    parseJson(
      bytes({ escape: 'a"\\\n', array: [true, null, -1.5e2, { x: 1 }] }),
    ),
    { escape: 'a"\\\n', array: [true, null, -150, { x: 1 }] },
  );
});

test('caller envelope has one exact schema and no path, command, environment or limit knobs', () => {
  assert.deepEqual(validateRequest(request()), request());
  for (const key of Object.keys(request())) {
    const v = request();
    delete v[key];
    assert.throws(() => validateRequest(v));
  }
  for (const key of ['path', 'env', 'command', 'runnerId', 'limits'])
    assert.throws(() => validateRequest({ ...request(), [key]: {} }));
  for (const patch of [
    { requestId: null },
    { requestId: 'x'.repeat(65) },
    { requestId: 'é' },
    { rendererHash: 'A'.repeat(64) },
    { schema: 'other' },
    { input: [] },
    {
      input: {
        schema: 'deckyard.edition-input/1',
        presentation: { slides: {} },
      },
    },
  ])
    assert.throws(() => validateRequest({ ...request(), ...patch }));
});

test('guest metadata has no authority: valid lies disappear, invalid output is refused', () => {
  const valid = {
    ok: true,
    canvas: '<h1>A</h1>',
    reader: 'A',
    sealed: { runnerId: 'lie', network: 'open', env: ['secret'] },
  };
  assert.deepEqual(validateOutput(bytes(valid)), {
    canvas: '<h1>A</h1>',
    reader: 'A',
  });
  for (const sealed of [null, [], 'yes', true])
    assert.throws(() => validateOutput(bytes({ ...valid, sealed })));
  for (const patch of [
    { ok: 1 },
    { canvas: null },
    { reader: 3 },
    { runnerId: 'lie' },
    { extra: false },
  ])
    assert.throws(() => validateOutput(bytes({ ...valid, ...patch })));
  for (const key of Object.keys(valid)) {
    const v = { ...valid };
    delete v[key];
    assert.throws(() => validateOutput(bytes(v)));
  }
  assert.throws(() => validateOutput(Buffer.concat([bytes(valid), bytes({})])));
  assert.throws(
    () =>
      validateOutput(
        bytes({
          ok: false,
          code: 'renderer_bundle_worker_failed',
          message: 'private input',
          details: null,
        }),
      ),
    /worker_failed/,
  );
  assert.throws(
    () =>
      validateOutput(
        bytes({
          ok: false,
          code: 'invented',
          message: 'private input',
          details: {},
        }),
      ),
    /worker_failed/,
  );
});

test('only broker-selected identity and closed errors can reach the response', () => {
  const parse = (v) => JSON.parse(v.subarray(4));
  assert.deepEqual(
    parse(
      responseBytes(
        request(),
        {
          canvas: 'a',
          reader: 'b',
          runnerId: 'guest',
          sealed: { input: 'secret' },
        },
        'broker',
      ),
    ),
    {
      schema: 'deckyard.renderer-runner.response/1',
      requestId: 'a_1',
      ok: true,
      rendererHash: 'a'.repeat(64),
      runnerId: 'broker',
      canvas: 'a',
      reader: 'b',
    },
  );
  assert.deepEqual(
    parse(responseBytes(null, { code: 'unknown', message: 'private' })),
    {
      schema: 'deckyard.renderer-runner.response/1',
      requestId: null,
      ok: false,
      code: 'sandbox_unavailable',
    },
  );
  const result = responseBytes(
    request(),
    { canvas: '\0'.repeat(Math.floor(OUTPUT_LIMIT / 6)), reader: '' },
    'broker',
  );
  assert.equal(parse(result).code, 'output_limit');
});

async function connected(t) {
  const server = net.createServer({
    allowHalfOpen: true,
    pauseOnConnect: true,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const accepted = once(server, 'connection');
  const client = net.createConnection({
    port: server.address().port,
    host: '127.0.0.1',
    allowHalfOpen: true,
  });
  client.on('error', () => {});
  const [socket] = await accepted;
  t.after(() => {
    socket.destroy();
    client.destroy();
    server.close();
  });
  return { client, socket };
}

test('a frame requires EOF, exact declared length and one absolute read deadline', async (t) => {
  const { client, socket } = await connected(t);
  const result = readFrame(socket, 50, 1000);
  client.write(frame(bytes({ a: 1 })));
  let settled = false;
  result.then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false);
  client.end();
  assert.deepEqual(parseJson(await result), { a: 1 });
});

for (const [name, data] of [
  ['zero header', Buffer.alloc(4)],
  ['oversized header', Buffer.from([0, 0, 1, 0])],
  ['truncated header', Buffer.from([0, 0])],
  [
    'truncated body',
    Buffer.concat([Buffer.from([0, 0, 0, 5]), Buffer.from('{}')]),
  ],
  [
    'second frame',
    Buffer.concat([frame(Buffer.from('{}')), frame(Buffer.from('{}'))]),
  ],
  [
    'trailing byte',
    Buffer.concat([frame(Buffer.from('{}')), Buffer.from('x')]),
  ],
])
  test(`framing refuses ${name}`, async (t) => {
    const { client, socket } = await connected(t);
    const result = readFrame(socket, 50, 1000);
    client.end(data);
    await assert.rejects(result, /invalid_request/);
  });

test('drip traffic does not extend the read deadline', async (t) => {
  const { client, socket } = await connected(t);
  const start = performance.now();
  const result = readFrame(socket, 50, 80);
  const timer = setInterval(() => client.write(Buffer.from([0])), 15);
  t.after(() => clearInterval(timer));
  await assert.rejects(result, /invalid_request/);
  assert.ok(performance.now() - start < 500);
});

test('runner identity binds policies and binaries independently of object order and installation nonce', async () => {
  const { runnerIdentity } =
    await import('../server/render/renderer-bundle/runner/identity.js');
  const a = {
    installation: 'one',
    callerUid: 10,
    callerGid: 11,
    subuid: 700000,
    subgid: 800000,
    build: { node: 'n', crun: 'c' },
    files: [{ path: 'x', mode: 0o444, sha256: 'x' }],
    serviceFiles: { b: 'b', a: 'a' },
  };
  const b = Object.fromEntries(Object.entries(a).reverse());
  b.installation = 'two';
  b.build = { crun: 'c', node: 'n' };
  b.serviceFiles = { a: 'a', b: 'b' };
  assert.equal(runnerIdentity(a), runnerIdentity(b));
  for (const patch of [
    { callerUid: 12 },
    { subuid: 900000 },
    { build: { node: 'changed', crun: 'c' } },
    { serviceFiles: { b: 'changed', a: 'a' } },
    { files: [{ path: 'x', mode: 0o644, sha256: 'x' }] },
  ])
    assert.notEqual(runnerIdentity(a), runnerIdentity({ ...a, ...patch }));
});
