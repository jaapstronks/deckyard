/**
 * `host.js` as the runner's broker client: configuration, the mapping of every
 * framed runner answer onto the closed refusal set (activation review A5), and
 * the shapes it does not accept.
 *
 * The broker here is a scripted Unix socket that speaks the wire contract
 * (docs/ops/renderer-runner.md § Wire contract): it reads one frame with the
 * shipped `readFrame`, validates it with the shipped `parseRequest`, and
 * answers what the case scripts. The real broker's admission is in
 * `tests/renderer-runner-admission.test.js`; refusing without configuration
 * is pinned in `tests/renderer-bundle-isolation.test.js`.
 *
 * Run with: node --test tests/renderer-bundle-host.test.js
 */

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  EDITION_INPUT_SCHEMA,
  RENDERER_BUNDLE_ERRORS,
  renderEditionInBundle,
  runnerSocketPath,
} from '../server/render/renderer-bundle/index.js';
import {
  REQUEST_LIMIT,
  RESPONSE_SCHEMA,
  parseRequest,
  readFrame,
} from '../server/render/renderer-bundle/runner/protocol.js';

const HASH = 'e'.repeat(64);
const RUNNER_ID = 'f'.repeat(64);
const input = { schema: EDITION_INPUT_SCHEMA, presentation: { slides: [] } };

const dir = await mkdtemp(path.join(tmpdir(), 'deckyard-host-client-'));
const socketPath = path.join(dir, 'broker.sock');

/** What the scripted broker answers next: `(request) => object|'close'`. */
let script = () => 'close';
/** Every request the scripted broker received. */
const received = [];
let connections = 0;

const broker = net.createServer(
  { allowHalfOpen: true, pauseOnConnect: true },
  async (socket) => {
    connections += 1;
    socket.on('error', () => {});
    let request;
    try {
      request = parseRequest(await readFrame(socket));
    } catch {
      socket.destroy();
      return;
    }
    received.push(request);
    const answer = script(request);
    if (answer === 'close') {
      socket.destroy();
      return;
    }
    const body = Buffer.from(
      typeof answer === 'string' ? answer : JSON.stringify(answer),
    );
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    socket.end(Buffer.concat([header, body]));
  },
);
await new Promise((resolve) => broker.listen(socketPath, resolve));

after(async () => {
  delete process.env.RENDERER_RUNNER_SOCKET;
  await new Promise((resolve) => broker.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  process.env.RENDERER_RUNNER_SOCKET = socketPath;
  received.length = 0;
  connections = 0;
});

const success = (request, extra = {}) => ({
  schema: RESPONSE_SCHEMA,
  requestId: request.requestId,
  ok: true,
  rendererHash: request.rendererHash,
  runnerId: RUNNER_ID,
  canvas: '<canvas>',
  reader: '<reader>',
  ...extra,
});
const refusal = (request, code) => ({
  schema: RESPONSE_SCHEMA,
  requestId: request.requestId,
  ok: false,
  code,
});

test('a framed success returns both documents, the hash and the runnerId (A4)', async () => {
  script = (request) => success(request);
  const result = await renderEditionInBundle(HASH, input);
  assert.deepEqual(result, {
    canvas: '<canvas>',
    reader: '<reader>',
    rendererHash: HASH,
    runnerId: RUNNER_ID,
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].rendererHash, HASH);
  assert.deepEqual(JSON.parse(received[0].input.toString('utf8')), input);
  assert.match(received[0].requestId, /^edition_[0-9a-f]{24}$/);
});

test('every framed runner refusal maps onto one closed bundle code (A5)', async () => {
  const mapping = {
    bundle_refused: RENDERER_BUNDLE_ERRORS.UNKNOWN,
    worker_failed: RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
    output_limit: RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
    invalid_request: RENDERER_BUNDLE_ERRORS.INPUT_INVALID,
    busy: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
    queue_timeout: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
    sandbox_unavailable: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
    // In the vocabulary but never framed; if one ever were, it is not a
    // refusal of this edition.
    job_timeout: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
    something_new: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
  };
  for (const [wire, code] of Object.entries(mapping)) {
    script = (request) => refusal(request, wire);
    await assert.rejects(
      () => renderEditionInBundle(HASH, input),
      (err) => {
        assert.equal(err.code, code, wire);
        assert.equal(
          err.message,
          `the renderer runner refused the edition (${code})`,
          'a fixed sentence per code, no text from across the wire',
        );
        return true;
      },
    );
  }
  assert.equal(received.length, Object.keys(mapping).length, 'no retry');
});

test('a closed connection without a frame is the runner being unavailable', async () => {
  script = () => 'close';
  await assert.rejects(() => renderEditionInBundle(HASH, input), {
    code: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
  });
  assert.equal(connections, 1, 'no second attempt');
});

test('a socket path with nothing listening is unavailable, not a fallback', async () => {
  process.env.RENDERER_RUNNER_SOCKET = path.join(dir, 'missing.sock');
  await assert.rejects(() => renderEditionInBundle(HASH, input), {
    code: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
  });
});

test('a frame for another request, hash or shape is refused', async () => {
  const wrong = [
    (r) => success(r, { requestId: 'edition_other' }),
    (r) => success(r, { rendererHash: '0'.repeat(64) }),
    (r) => success(r, { runnerId: 'short' }),
    (r) => success(r, { canvas: 1 }),
    (r) => ({ ...success(r), sealed: {} }),
    (r) => ({ ...refusal(r, 'busy'), message: 'guest text' }),
    (r) => ({ ...success(r), schema: 'deckyard.renderer-runner.response/2' }),
    () => 'not json',
  ];
  for (const answer of wrong) {
    script = answer;
    await assert.rejects(() => renderEditionInBundle(HASH, input), {
      code: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
    });
  }
});

test('a request over the runner limit is refused before connecting', async () => {
  const big = {
    ...input,
    presentation: {
      slides: [
        {
          id: 's1',
          type: 'image',
          content: { src: 'x'.repeat(REQUEST_LIMIT) },
        },
      ],
    },
  };
  await assert.rejects(
    () => renderEditionInBundle(HASH, big),
    (err) => {
      assert.equal(err.code, RENDERER_BUNDLE_ERRORS.UNSEALABLE_INPUT);
      assert.equal(err.details.limit, REQUEST_LIMIT);
      assert.ok(err.details.bytes > REQUEST_LIMIT);
      return true;
    },
  );
  assert.equal(connections, 0);
});

test('a malformed hash is refused before connecting', async () => {
  await assert.rejects(() => renderEditionInBundle('E'.repeat(64), input), {
    code: RENDERER_BUNDLE_ERRORS.MALFORMED_HASH,
  });
  assert.equal(connections, 0);
});

test('P16: only an absolute Unix socket path is a configuration; TCP spellings refuse without connecting', async () => {
  let tcp = 0;
  const listener = net.createServer((s) => {
    tcp += 1;
    s.destroy();
  });
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  const untouchable = new Proxy(
    {},
    {
      get() {
        assert.fail('an unconfigured runner must not inspect its arguments');
      },
    },
  );
  try {
    for (const value of [
      '',
      `127.0.0.1:${port}`,
      `tcp://127.0.0.1:${port}`,
      `localhost:${port}`,
      String(port),
      'relative/broker.sock',
      '/run/../run/deckyard-render/broker.sock',
      `/${'x'.repeat(200)}`,
    ]) {
      process.env.RENDERER_RUNNER_SOCKET = value;
      assert.equal(runnerSocketPath(), null, value);
      await assert.rejects(() => renderEditionInBundle(untouchable, input), {
        code: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE,
      });
    }
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
  assert.equal(tcp, 0, 'no TCP connection was attempted');
  assert.equal(connections, 0);
});
