/**
 * The runner's lifecycle around registration (runner iteration 5).
 *
 * On the first real host reboot the supervisor started the broker once, that
 * broker ended within two seconds without a journal line, and nothing started
 * it again. This file pins the three repairs that do not need systemd:
 *
 * - `brokerLauncher` relaunches a broker that settles `failed`/`inactive`
 *   before it registers, with a bounded backoff, and then blocks once;
 * - `brokerPeerRefusal` names the condition a lifecycle peer failed, so the
 *   supervisor can log it;
 * - the shipped broker writes one stderr line when it loses the supervisor
 *   and exits 0 on SIGTERM (the broker double, as in the admission test).
 *
 * Runner iteration 6 adds the launcher's retirement tail (no unit job and no
 * alarm during a supervisor stop), the overdue line for a broker that stays
 * active without connecting, and the journal line for a dropped second
 * lifecycle connection.
 *
 * The real boot stays evidence of the Linux acceptance (docs/ops/renderer-runner.md).
 *
 * Run with: node --test tests/renderer-runner-lifecycle.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { brokerLauncher } from '../server/render/renderer-bundle/runner/broker-launch.js';
import { brokerPeerRefusal } from '../server/render/renderer-bundle/runner/service-policy.js';
import {
  lifecycleChannel,
  lifecycleServer,
} from '../server/render/renderer-bundle/runner/channel.js';

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Wait until `check()` is true, or fail after `ms`. */
async function until(check, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail('timed out waiting for the launcher');
    await tick(5);
  }
}

/** A fake broker unit: `start()` queues an invocation that ends as `outcome`. */
function harness(outcomes, { delays = [5, 5, 5], poll = 2 } = {}) {
  const logs = [];
  let unit = { ActiveState: 'inactive', Job: '', Result: 'success' },
    instance = false,
    starts = 0;
  const launcher = brokerLauncher({
    start() {
      const outcome = outcomes[starts++] ?? 'fail';
      unit = { ActiveState: 'inactive', Job: '7 start', Result: 'success' };
      setTimeout(() => {
        if (outcome === 'register') {
          unit = { ActiveState: 'active', Job: '', Result: 'success' };
          instance = true;
          launcher.registered();
        } else
          unit = {
            ActiveState: 'failed',
            Job: '',
            Result: 'exit-code',
            ExecMainStatus: '1',
          };
      }, 3);
    },
    state: async () => unit,
    busy: () => instance,
    log: (phase, detail) => logs.push({ phase, ...detail }),
    delays,
    poll,
  });
  return { launcher, logs, starts: () => starts };
}

test('a broker that registers on the first launch is launched once', async () => {
  const { launcher, logs, starts } = harness(['register']);
  launcher.launch();
  await tick(60);
  assert.equal(starts(), 1);
  assert.deepEqual(logs, []);
  launcher.stop();
});

test('a broker that dies before registration is launched again until it registers', async () => {
  const { launcher, logs, starts } = harness(['fail', 'fail', 'register']);
  launcher.launch();
  await until(() => starts() === 3);
  await tick(30);
  assert.equal(starts(), 3);
  assert.deepEqual(
    logs.map((l) => [l.phase, l.attempt, l.result]),
    [
      ['broker_not_registered', 0, 'exit-code'],
      ['broker_not_registered', 1, 'exit-code'],
    ],
  );
  launcher.stop();
});

test('the relaunch is bounded: after the last delay it blocks once', async () => {
  const { launcher, logs, starts } = harness([]);
  launcher.launch();
  await until(() => logs.at(-1)?.phase === 'broker_launch_blocked');
  assert.equal(starts(), 4, 'one launch plus one per delay');
  assert.deepEqual(
    logs.map((l) => l.phase),
    [
      'broker_not_registered',
      'broker_not_registered',
      'broker_not_registered',
      'broker_not_registered',
      'broker_launch_blocked',
    ],
  );
  await tick(60);
  assert.equal(starts(), 4, 'nothing after broker_launch_blocked');
  launcher.stop();
});

test('a pending start job or an activating unit is not a verdict', async () => {
  const logs = [];
  let calls = 0;
  const states = [
    { ActiveState: 'inactive', Job: '9 start' },
    { ActiveState: 'activating', Job: '' },
    { ActiveState: 'active', Job: '' },
  ];
  const launcher = brokerLauncher({
    start() {},
    state: async () => states[Math.min(calls++, states.length - 1)],
    busy: () => false,
    log: (phase) => logs.push(phase),
    delays: [5],
    poll: 2,
  });
  launcher.launch();
  await until(() => calls >= 3);
  assert.deepEqual(logs, []);
  launcher.stop();
});

test('a failed unit query is asked again, not counted', async () => {
  const logs = [];
  let calls = 0;
  const launcher = brokerLauncher({
    start() {},
    state: async () => {
      calls++;
      throw new Error('timeout');
    },
    busy: () => false,
    log: (phase) => logs.push(phase),
    delays: [5],
    poll: 2,
  });
  launcher.launch();
  await until(() => calls >= 3);
  assert.deepEqual(logs, []);
  launcher.stop();
});

test('a start that cannot be enqueued counts as an unregistered launch', async () => {
  const logs = [];
  let starts = 0;
  const launcher = brokerLauncher({
    start() {
      starts++;
      throw new Error('systemctl timed out');
    },
    state: async () => ({ ActiveState: 'failed', Job: '' }),
    busy: () => false,
    log: (phase) => logs.push(phase),
    delays: [5],
    poll: 2,
  });
  launcher.launch();
  await until(() => logs.at(-1) === 'broker_launch_blocked');
  assert.equal(starts, 2);
  assert.deepEqual(logs, [
    'broker_start_failed',
    'broker_not_registered',
    'broker_start_failed',
    'broker_not_registered',
    'broker_launch_blocked',
  ]);
  launcher.stop();
});

test('registration resets the backoff for the next launch', async () => {
  const { launcher, logs, starts } = harness(['fail', 'register', 'fail']);
  launcher.launch();
  await until(() => starts() === 2);
  await tick(30);
  assert.equal(starts(), 2);
  launcher.stop();
  assert.equal(logs.at(-1).attempt, 0);
});

test('a stopped launcher neither queries nor launches', async () => {
  const { launcher, starts } = harness([]);
  launcher.launch();
  launcher.stop();
  await tick(60);
  assert.equal(starts(), 1);
});

/** A launcher whose unit stop and start are counted, for retirements. */
function retirement() {
  const calls = [];
  const launcher = brokerLauncher({
    start: () => calls.push('start'),
    stopUnit: () => calls.push('stop'),
    state: async () => ({ ActiveState: 'active', Job: '' }),
    busy: () => true,
    log: (phase) => calls.push(phase),
    poll: 2,
  });
  return { launcher, calls };
}

test('a retirement stops the old unit, then launches or reports the self-test', (t) => {
  const healthy = retirement();
  t.after(() => healthy.launcher.stop());
  healthy.launcher.retired(true);
  assert.deepEqual(healthy.calls, ['stop', 'start']);
  healthy.launcher.stop();
  const unready = retirement();
  unready.launcher.retired(false);
  assert.deepEqual(unready.calls, ['stop', 'self_test_not_ready']);
});

test('a retirement during a supervisor stop touches no unit and reports nothing', () => {
  // Iteration 5 logged broker_start_failed or instance_retirement_blocked here:
  // systemd refuses broker jobs while it stops the supervisor.
  const { launcher, calls } = retirement();
  launcher.stop();
  assert.equal(launcher.stopped, true);
  launcher.retired(true);
  launcher.retired(false);
  assert.deepEqual(calls, []);
});

test('a broker that stays active without registering is reported once', async (t) => {
  const logs = [];
  let calls = 0;
  const launcher = brokerLauncher({
    start() {},
    state: async () => {
      calls++;
      return { ActiveState: 'active', Job: '' };
    },
    busy: () => false,
    log: (phase, detail) => logs.push({ phase, ...detail }),
    poll: 2,
    overdue: 20,
  });
  t.after(() => launcher.stop());
  launcher.launch();
  await until(() => logs.length > 0);
  const seen = calls;
  await until(() => calls >= seen + 10);
  assert.deepEqual(
    logs.map((l) => l.phase),
    ['broker_registration_overdue'],
  );
  assert.ok(logs[0].activeMs >= 20);
  launcher.stop();
});

test('a relaunch reports its own overdue broker again', async (t) => {
  const logs = [];
  const launcher = brokerLauncher({
    start() {},
    state: async () => ({ ActiveState: 'active', Job: '' }),
    busy: () => false,
    log: (phase) => logs.push(phase),
    poll: 2,
    overdue: 10,
  });
  t.after(() => launcher.stop());
  launcher.launch();
  await until(() => logs.length === 1);
  launcher.launch();
  await until(() => logs.length === 2);
  assert.deepEqual(logs, [
    'broker_registration_overdue',
    'broker_registration_overdue',
  ]);
  launcher.stop();
});

test('an activating unit or a queued job is not overdue', async (t) => {
  const logs = [];
  let calls = 0;
  const launcher = brokerLauncher({
    start() {},
    state: async () => {
      calls++;
      return calls % 2
        ? { ActiveState: 'activating', Job: '' }
        : { ActiveState: 'active', Job: '8 start' };
    },
    busy: () => false,
    log: (phase) => logs.push(phase),
    poll: 2,
    overdue: 5,
  });
  t.after(() => launcher.stop());
  launcher.launch();
  await until(() => calls >= 30);
  assert.deepEqual(logs, []);
  launcher.stop();
});

test('a second lifecycle connection is dropped with a journal line', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'deckyard-lifecycle-'));
  const sock = path.join(dir, 'supervisor.sock');
  const logs = [];
  const held = [];
  const server = lifecycleServer(
    (socket) => held.push(socket),
    (phase) => logs.push(phase),
  );
  await new Promise((resolve) => server.listen(sock, resolve));
  t.after(async () => {
    for (const socket of held) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const first = net.connect(sock);
  await until(() => held.length === 1);
  const second = net.connect(sock);
  const closed = new Promise((resolve) => second.once('close', resolve));
  second.on('error', () => {});
  await closed;
  await until(() => logs.length === 1);
  assert.deepEqual(logs, ['lifecycle_connection_dropped']);
  assert.equal(held.length, 1, 'the second connection is never admitted');
  assert.equal(held[0].isPaused(), true, 'admission starts paused');
  first.destroy();
});

const BROKER = '/system.slice/deckyard-render-broker.service';
const unitState = {
  MainPID: '42',
  InvocationID: 'abc',
  ControlGroup: BROKER,
};
const refusal = (peer = {}, state = {}, cgroup = `0::${BROKER}`, extra = {}) =>
  brokerPeerRefusal(
    { uid: 0, pid: 42, ...peer },
    { ...unitState, ...state },
    cgroup,
    extra.exited ?? false,
    extra.registered ?? false,
  );

test('the broker unit main process passes the peer check', () => {
  assert.equal(refusal(), null);
});

test('each failed peer condition has its own name', () => {
  assert.equal(refusal({ uid: 1000 }), 'peer_uid');
  assert.equal(
    refusal({}, {}, undefined, { registered: true }),
    'instance_registered',
  );
  assert.equal(refusal({ pid: 43 }), 'main_pid');
  assert.equal(refusal({}, { MainPID: '0' }), 'main_pid');
  assert.equal(refusal({}, { InvocationID: '' }), 'invocation_id');
  assert.equal(
    refusal({}, { ControlGroup: '/system.slice/other.service' }),
    'control_group',
  );
  assert.equal(refusal({}, {}, '0::/user.slice'), 'proc_cgroup');
  assert.equal(refusal({}, {}, null), 'proc_cgroup');
  assert.equal(refusal({}, {}, undefined, { exited: true }), 'peer_exited');
});

const here = path.dirname(fileURLToPath(import.meta.url));

test('every test file a runner module names exists', () => {
  const runner = path.join(
    here,
    '..',
    'server',
    'render',
    'renderer-bundle',
    'runner',
  );
  const named = readdirSync(runner)
    .filter((name) => name.endsWith('.js'))
    .flatMap((name) =>
      [
        ...readFileSync(path.join(runner, name), 'utf8').matchAll(
          /tests\/[\w./-]+\.test\.js/g,
        ),
      ].map((match) => [name, match[0]]),
    );
  assert.ok(named.length > 0);
  for (const [name, file] of named)
    assert.ok(existsSync(path.join(here, '..', file)), `${name} names ${file}`);
});

const START = path.join(here, 'helpers', 'renderer-broker-double', 'start.js');

/** Start a broker double against a supervisor that does `onConnect`. */
async function brokerDouble(onConnect) {
  const dir = await mkdtemp(path.join(tmpdir(), 'deckyard-broker-life-'));
  await mkdir(path.join(dir, 'store'));
  const supervisor = net.createServer(onConnect);
  await new Promise((resolve) =>
    supervisor.listen(path.join(dir, 'supervisor.sock'), resolve),
  );
  const child = spawn(process.execPath, [START], {
    env: {
      ...process.env,
      BROKER_DOUBLE_DIR: dir,
      BROKER_DOUBLE_SELF_TEST_HASH: 'a'.repeat(64),
      BROKER_DOUBLE_RUNNER_ID: 'b'.repeat(64),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  return {
    child,
    exited,
    stderr: () => stderr,
    async close() {
      child.kill('SIGKILL');
      await new Promise((resolve) => supervisor.close(resolve));
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test('a broker refused before registration exits 1 with one stderr line', async () => {
  const broker = await brokerDouble((socket) => socket.destroy());
  const { code } = await broker.exited;
  assert.equal(code, 1);
  assert.equal(
    broker.stderr(),
    'renderer broker lost supervisor (unregistered)\n',
  );
  await broker.close();
});

test('a registered broker exits 0 on SIGTERM, without the loss line', async () => {
  let registered;
  const ready = new Promise((resolve) => (registered = resolve));
  const broker = await brokerDouble((socket) => {
    const bound = { instance: '1'.repeat(32), generation: '2'.repeat(32) };
    const channel = lifecycleChannel(
      socket,
      (message) => {
        if (message.op === 'reserve') registered();
      },
      () => {},
    );
    channel.send({ op: 'registered', ...bound });
  });
  await ready;
  broker.child.kill('SIGTERM');
  const { code } = await broker.exited;
  assert.equal(code, 0);
  assert.equal(broker.stderr(), '');
  await broker.close();
});
