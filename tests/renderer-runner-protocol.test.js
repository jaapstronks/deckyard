import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import {
  parseJson,
  parseRequest,
  validateOutput,
  successParts,
  refusalBytes,
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

const refused = (v) => {
  try {
    parseRequest(typeof v === 'string' ? Buffer.from(v) : bytes(v));
  } catch (error) {
    assert.equal(error.message, 'invalid_request');
    return error.requestId;
  }
  assert.fail('request accepted');
};

test('caller envelope has one exact schema and no path, command, environment or limit knobs', () => {
  const parsed = parseRequest(bytes(request()));
  assert.deepEqual(
    { ...parsed, input: JSON.parse(parsed.input) },
    { ...request() },
  );
  for (const key of Object.keys(request())) {
    const v = request();
    delete v[key];
    refused(v);
  }
  for (const key of [
    'path',
    'env',
    'command',
    'runnerId',
    'limits',
    '__proto__',
    'constructor',
  ])
    assert.equal(
      refused(
        JSON.stringify(request()).replace(/}$/, `,${JSON.stringify(key)}:{}}`),
      ),
      'a_1',
    );
  for (const patch of [
    { requestId: null },
    { requestId: 'x'.repeat(65) },
    { requestId: 'é' },
    { requestId: 'a\n' },
    { rendererHash: 'a'.repeat(64) + '\n' },
    { rendererHash: 'A'.repeat(64) },
    { schema: 'other' },
    { input: [] },
    { input: { schema: 'other', presentation: { slides: [] } } },
    { input: { schema: 'deckyard.edition-input/1', presentation: [] } },
    {
      input: {
        schema: 'deckyard.edition-input/1',
        presentation: { slides: {} },
      },
    },
  ])
    refused({ ...request(), ...patch });
  assert.equal(refused({ ...request(), schema: 'other' }), 'a_1');
  assert.equal(refused({ ...request(), requestId: 'a\n' }), null);
  assert.equal(refused(`\ufeff${JSON.stringify(request())}`), null);
  assert.equal(
    refused(
      JSON.stringify(request()).replace(
        '"slides":[]',
        '"slides":[{"a":1,"a":2}]',
      ),
    ),
    null,
  );
});

test('the validated input is forwarded as the caller bytes, not a rebuilt tree', () => {
  const source =
    '{ "input" : {"presentation":{ "title":"\\u0041", "slides":[ {} ] },"schema":"deckyard.edition-input/1"},' +
    '"schema":"deckyard.renderer-runner.request/1","requestId":"r","rendererHash":"' +
    'b'.repeat(64) +
    '"}';
  const parsed = parseRequest(Buffer.from(source));
  assert.equal(
    parsed.input.toString(),
    '{"presentation":{ "title":"\\u0041", "slides":[ {} ] },"schema":"deckyard.edition-input/1"}',
  );
  assert.deepEqual(Object.keys(parsed), [
    'schema',
    'requestId',
    'rendererHash',
    'input',
  ]);
});

const success = (bytesValue) => {
  const result = validateOutput(bytesValue, request(), 'broker');
  const parts = successParts(result, bytesValue);
  // The documents are views on the guest output, not copies.
  assert.equal(parts[2].buffer, bytesValue.buffer);
  assert.equal(parts[4].buffer, bytesValue.buffer);
  const frame = Buffer.concat(parts);
  assert.equal(frame.readUInt32BE(), frame.length - 4);
  return JSON.parse(frame.subarray(4));
};

test('guest metadata has no authority: valid lies disappear, invalid output is refused', () => {
  const valid = {
    ok: true,
    canvas: '<h1>A</h1>',
    reader: 'A',
    sealed: { runnerId: 'lie', network: 'open', env: ['secret'] },
  };
  assert.deepEqual(success(bytes(valid)), {
    schema: 'deckyard.renderer-runner.response/1',
    requestId: 'a_1',
    ok: true,
    rendererHash: 'a'.repeat(64),
    runnerId: 'broker',
    canvas: '<h1>A</h1>',
    reader: 'A',
  });
  for (const sealed of [null, [], 'yes', true])
    assert.throws(() => validateOutput(bytes({ ...valid, sealed })));
  for (const patch of [
    { ok: 1 },
    { ok: 'true' },
    { canvas: null },
    { canvas: ['x'] },
    { reader: 3 },
    { runnerId: 'lie' },
    { extra: false },
  ])
    assert.throws(
      () => validateOutput(bytes({ ...valid, ...patch }), request(), 'b'),
      /worker_failed/,
    );
  for (const key of Object.keys(valid)) {
    const v = { ...valid };
    delete v[key];
    assert.throws(() => validateOutput(bytes(v), request(), 'b'));
  }
  for (const raw of [
    Buffer.concat([bytes(valid), bytes({})]),
    Buffer.from('{"ok":true,"canvas":"a\\u12","reader":"","sealed":{}}'),
    Buffer.from('{"ok":true,"canvas":"\\x","reader":"","sealed":{}}'),
    Buffer.from('{"ok":true,"canvas":"\t","reader":"","sealed":{}}'),
    Buffer.from('{"ok":true,"canvas":"x","reader":"","sealed":{},"ok":true}'),
    Buffer.from('{"ok":true,"canvas":"x","reader":"","sealed":{}'),
  ])
    assert.throws(() => validateOutput(raw, request(), 'b'), /worker_failed/);
  for (const refusal of [
    {
      ok: false,
      code: 'renderer_bundle_worker_failed',
      message: 'private input',
      details: null,
    },
    { ok: false, code: 'invented', message: 'private input', details: {} },
  ])
    assert.throws(
      () => validateOutput(bytes(refusal), request(), 'b'),
      /worker_failed/,
    );
});

test('the success frame copies validated string tokens without re-encoding drift', () => {
  const raw = Buffer.from(
    '{"sealed":{},"reader":"r\\u00e9\\n","ok":true,"canvas":"<p>\\"é\\ud800</p>"}',
  );
  const v = success(raw);
  assert.equal(v.canvas, '<p>"é\ud800</p>');
  assert.equal(v.reader, 'ré\n');
  assert.deepEqual(Object.keys(v), [
    'schema',
    'requestId',
    'ok',
    'rendererHash',
    'runnerId',
    'canvas',
    'reader',
  ]);
});

test('only broker-selected identity and closed errors can reach the response', () => {
  const parse = (v) => JSON.parse(v.subarray(4));
  assert.deepEqual(parse(refusalBytes(null, 'unknown')), {
    schema: 'deckyard.renderer-runner.response/1',
    requestId: null,
    ok: false,
    code: 'sandbox_unavailable',
  });
  assert.deepEqual(parse(refusalBytes({ requestId: 'r' }, 'busy')), {
    schema: 'deckyard.renderer-runner.response/1',
    requestId: 'r',
    ok: false,
    code: 'busy',
  });
  // Escaping counts: a guest string of control characters fits the 64 MiB
  // stdout limit but not the serialized response limit.
  const controls = Buffer.from(
    `{"ok":true,"canvas":"${'\\u0001'.repeat(Math.floor(OUTPUT_LIMIT / 6) - 20)}","reader":"","sealed":{}}`,
  );
  assert.ok(controls.length <= OUTPUT_LIMIT);
  assert.deepEqual(validateOutput(controls, request(), 'broker'), {
    code: 'output_limit',
  });
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

test('cancellation after normal quiescence remains terminal and keeps the first cleanup deadline', async () => {
  const { revokeRecord } =
    await import('../server/render/renderer-bundle/runner/ledger.js');
  for (const phase of [
    'RESERVED',
    'PREPARING',
    'RUNNING',
    'TERMINATING',
    'PRODUCERS_STOPPED',
    'CLEANING',
  ]) {
    const job = { phase, cancelled: false, revokedAt: 50 };
    assert.equal(revokeRecord(job, 'job_cancelled', 100), true);
    assert.equal(job.cancelled, true);
    assert.equal(job.revokedAt, 50);
    assert.equal(
      job.phase,
      ['RESERVED', 'PREPARING', 'RUNNING'].includes(phase)
        ? 'TERMINATING'
        : phase,
    );
    const snapshot = structuredClone(job);
    assert.equal(revokeRecord(job, 'job_timeout', 200), false);
    assert.deepEqual(job, snapshot);
  }
  const cleaned = { phase: 'CLEANED', cancelled: false };
  assert.equal(revokeRecord(cleaned, 'job_cancelled', 100), false);
  assert.deepEqual(cleaned, { phase: 'CLEANED', cancelled: false });
});

test('containment paths come only from an internal UUID, never a lifecycle path field', async () => {
  const { jobPaths, SUPERVISOR_CGROUP } =
    await import('../server/render/renderer-bundle/runner/paths.js');
  const id = 'a'.repeat(32);
  assert.deepEqual(jobPaths(id), {
    helper: `/sys/fs/cgroup${SUPERVISOR_CGROUP}/helpers/${id}`,
    guest: `${SUPERVISOR_CGROUP}/jobs/${id}`,
  });
  for (const invalid of [
    '../job',
    '/host',
    'A'.repeat(32),
    '',
    'a'.repeat(33),
    'a'.repeat(32) + '\n',
  ])
    assert.throws(() => jobPaths(invalid));
});

test('loaded producer policy must deny every AIO syscall before Node starts', async () => {
  const { assertProducerPolicy } =
    await import('../server/render/renderer-bundle/runner/service-policy.js');
  const names = [
    'io_setup',
    'io_submit',
    'io_getevents',
    'io_pgetevents',
    'io_cancel',
    'io_destroy',
    'io_uring_setup',
    'io_uring_enter',
    'io_uring_register',
  ];
  const properties = {
    DropInPaths: '',
    SystemCallFilter: `~${names.join(' ')}`,
    SystemCallArchitectures: 'native',
    SystemCallErrorNumber: '1',
  };
  assert.doesNotThrow(() => assertProducerPolicy(properties));
  for (const patch of [
    { SystemCallFilter: '' },
    { SystemCallFilter: `~${names.slice(1).join(' ')}` },
    { SystemCallArchitectures: '' },
    { SystemCallErrorNumber: '38' },
    { DropInPaths: '/unreviewed.conf' },
  ])
    assert.throws(() => assertProducerPolicy({ ...properties, ...patch }));
});

test('startup compaction drops only proven CLEANED tombstones and keeps every other record', async () => {
  const { compactLedger } =
    await import('../server/render/renderer-bundle/runner/ledger.js');
  const phases = [
    'RESERVED',
    'PREPARING',
    'RUNNING',
    'TERMINATING',
    'PRODUCERS_STOPPED',
    'CLEANING',
  ];
  const ledger = {
    jobs: [
      ...Array.from({ length: 378 }, (_, i) => ({
        id: String(i),
        phase: 'CLEANED',
      })),
      ...phases.map((phase) => ({ id: phase, phase })),
    ],
  };
  assert.equal(compactLedger(ledger), 378);
  assert.deepEqual(
    ledger.jobs.map((job) => job.phase),
    phases,
  );
  const size = JSON.stringify(ledger).length;
  assert.equal(compactLedger(ledger), 0);
  assert.equal(JSON.stringify(ledger).length, size);
});
