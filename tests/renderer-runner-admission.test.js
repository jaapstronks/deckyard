/**
 * The runner broker's admission refuses an unregistered renderer hash without
 * a job (D364), and the production host maps that onto
 * `renderer_bundle_unknown`.
 *
 * Until this test the refusal rested only on the Linux root acceptance (P1,
 * audit 110). It runs the shipped `runner/broker.js` in a child process with
 * the broker double (`tests/helpers/renderer-broker-double/`): root paths,
 * the native peer check, the producer Worker and the socket chown are stand-ins,
 * the admission, queue, framing and lifecycle channel are the real modules.
 * This test plays the supervisor over the real lifecycle channel and calls the
 * broker through the real `host.js`, so both halves of the wire meet here.
 *
 * It proves the broker's order of decisions, not the boundary: the external
 * Linux gate (docs/ops/renderer-runner.md § External Linux acceptance record)
 * stays the evidence for that.
 *
 * Run with: node --test tests/renderer-runner-admission.test.js
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lifecycleChannel } from '../server/render/renderer-bundle/runner/channel.js';
import {
  EDITION_INPUT_SCHEMA,
  RENDERER_BUNDLE_ERRORS,
  renderEditionInBundle,
} from '../server/render/renderer-bundle/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const START = path.join(here, 'helpers', 'renderer-broker-double', 'start.js');

const SELF_TEST = 'a'.repeat(64);
const RUNNER_ID = 'b'.repeat(64);
const REGISTERED = 'c'.repeat(64);
const UNREGISTERED = 'd'.repeat(64);
const INSTANCE = '1'.repeat(32);
const GENERATION = '2'.repeat(32);
const input = { schema: EDITION_INPUT_SCHEMA, presentation: { slides: [] } };

/** Wait until `check()` is true, or fail after `ms`. */
async function until(check, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail('timed out waiting for the broker');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const dir = await mkdtemp(path.join(tmpdir(), 'deckyard-broker-double-'));
await mkdir(path.join(dir, 'store'));

// The supervisor half: register the broker, then answer every reservation
// through the normal phases. Every op the broker sends is kept.
const ops = [];
let jobs = 0;
const supervisor = net.createServer((socket) => {
  const bound = { instance: INSTANCE, generation: GENERATION };
  const channel = lifecycleChannel(
    socket,
    (message) => {
      ops.push(message.op);
      if (message.op === 'reserve') {
        jobs += 1;
        channel.send({
          op: 'reserved',
          ...bound,
          job: jobs.toString(16).padStart(32, '0'),
        });
      } else if (message.op === 'running')
        channel.send({ op: 'running', ...bound, job: message.job });
      else if (message.op === 'quiescent')
        channel.send({ op: 'cleaned', ...bound, job: message.job });
    },
    () => {},
  );
  channel.send({ op: 'registered', ...bound });
});
await new Promise((resolve) =>
  supervisor.listen(path.join(dir, 'supervisor.sock'), resolve),
);

const workers = [];
const broker = spawn(process.execPath, [START], {
  env: {
    ...process.env,
    BROKER_DOUBLE_DIR: dir,
    BROKER_DOUBLE_SELF_TEST_HASH: SELF_TEST,
    BROKER_DOUBLE_RUNNER_ID: RUNNER_ID,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
broker.stdout.setEncoding('utf8');
broker.stdout.on('data', (chunk) => {
  for (const line of chunk.split('\n').filter(Boolean))
    workers.push(JSON.parse(line).worker);
});

after(async () => {
  broker.kill('SIGKILL');
  await new Promise((resolve) => supervisor.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

const socket = path.join(dir, 'broker.sock');
await until(() => existsSync(socket));
process.env.RENDERER_RUNNER_SOCKET = socket;
after(() => {
  delete process.env.RENDERER_RUNNER_SOCKET;
});

test('the broker opens admission only after its self-test job cleaned', () => {
  assert.deepEqual(workers, ['runner-self-test']);
  assert.deepEqual(ops, ['reserve', 'running', 'quiescent']);
});

test('an unregistered hash is refused at admission, without a reservation or a job', async () => {
  const before = ops.length;
  await assert.rejects(() => renderEditionInBundle(UNREGISTERED, input), {
    code: RENDERER_BUNDLE_ERRORS.UNKNOWN,
  });
  assert.deepEqual(ops.slice(before), [], 'no reserve after the refusal');
  assert.deepEqual(workers, ['runner-self-test'], 'no producer Worker');
});

test('a hash that is a symlink in the store is not registered', async () => {
  const { symlink } = await import('node:fs/promises');
  await mkdir(path.join(dir, 'elsewhere'));
  await symlink(
    path.join(dir, 'elsewhere'),
    path.join(dir, 'store', UNREGISTERED),
  );
  const before = ops.length;
  await assert.rejects(() => renderEditionInBundle(UNREGISTERED, input), {
    code: RENDERER_BUNDLE_ERRORS.UNKNOWN,
  });
  assert.deepEqual(ops.slice(before), []);
});

test('registering the hash makes the same broker serve the next request', async () => {
  await mkdir(path.join(dir, 'store', REGISTERED));
  const pid = broker.pid;
  const result = await renderEditionInBundle(REGISTERED, input);
  assert.deepEqual(result, {
    canvas: `rendered ${REGISTERED}`,
    reader: `rendered ${REGISTERED}`,
    rendererHash: REGISTERED,
    runnerId: RUNNER_ID,
  });
  assert.equal(broker.pid, pid);
  assert.equal(broker.exitCode, null, 'the broker instance kept running');
  assert.equal(workers.length, 2);
  assert.match(workers[1], /^edition_[0-9a-f]{24}$/);
  assert.deepEqual(ops.slice(-3), ['reserve', 'running', 'quiescent']);
});
