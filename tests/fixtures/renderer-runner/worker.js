// Operator-registered adversarial fixture. It replaces only manifest.worker,
// never the trusted bootstrap. No production consumer imports this file.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
fs.writeSync(2, 'HISTORICAL_FIRST_INSTRUCTION\n');
const require = createRequire(import.meta.url);
const native = require('/bundle/files/probe.node');
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks));
const mode = input.presentation.title;
const finish = (canvas, sealed = {}) =>
  process.stdout.write(
    JSON.stringify({
      ok: true,
      canvas: JSON.stringify(canvas),
      reader: 'fixture',
      sealed,
    }),
  );
if (mode === 'spin')
  for (;;) {
    /* Deliberate CPU exhaustion. */
  } // Deliberately exceeds the supervisor deadline.
else if (mode === 'sleep')
  await new Promise((resolve) => setTimeout(resolve, 25000));
else if (mode === 'oom') {
  const held = [];
  for (;;) held.push(Buffer.alloc(8 * 1024 * 1024, 1));
} else if (mode === 'stdout')
  for (;;) process.stdout.write('x'.repeat(1024 * 1024));
else if (mode === 'stderr')
  for (;;) process.stderr.write('x'.repeat(1024 * 1024));
else if (mode === 'scratch') {
  const fd = fs.openSync('/tmp/full', 'wx');
  for (;;) fs.writeSync(fd, Buffer.alloc(1024 * 1024, 1));
} else if (mode === 'threadstorm') {
  for (;;) new Worker('for (;;) {}', { eval: true });
} else if (mode === 'x32') native.x32();
else if (mode === 'compat') native.compat();
else if (mode === 'syscalls') finish(native.probe());
else if (mode === 'network') {
  while (!fs.existsSync('/tmp/network-ready'))
    await new Promise((resolve) => setTimeout(resolve, 5));
  const net = await import('node:net');
  const dgram = await import('node:dgram');
  const dns = await import('node:dns/promises');
  const results = {};
  for (const [name, options] of [
    ['tcp4', { host: '127.0.0.1', port: 48471 }],
    ['tcp6', { host: '::1', port: 48472 }],
    ['unix', { path: '/tmp/network-listener.sock' }],
  ]) {
    results[name] = await new Promise((resolve) => {
      const s = net.createConnection(options);
      s.once('connect', () => {
        s.destroy();
        resolve('CONNECTED');
      });
      s.once('error', (e) => resolve(e.code));
    });
  }
  for (const [name, type, host, port] of [
    ['udp4', 'udp4', '127.0.0.1', 48471],
    ['udp6', 'udp6', '::1', 48472],
  ]) {
    results[name] = await new Promise((resolve) => {
      const s = dgram.createSocket(type);
      s.once('error', (e) => {
        s.close();
        resolve(e.code);
      });
      s.send('guest', port, host, (e) => {
        s.close();
        resolve(e?.code || 'SENT');
      });
    });
  }
  for (const [name, operation] of [
    ['fetch', () => fetch('http://127.0.0.1:48471')],
    ['dns', () => dns.resolve4('runner.invalid')],
  ]) {
    try {
      await operation();
      results[name] = 'ALLOWED';
    } catch (e) {
      results[name] = e.cause?.code || e.code || e.name;
    }
  }
  results.builtinSocket = await new Promise((resolve) => {
    const s = process
      .getBuiltinModule('net')
      .createConnection(48471, '127.0.0.1');
    s.once('error', (e) => resolve(e.code));
  });
  finish({ results, direct: native.probe() });
} else if (mode === 'inventory') {
  const denied = {};
  for (const p of [
    '/root/deckyard-render-canary',
    '/home/jaap/.ssh',
    '/var/lib/deckyard-render',
    '/run/deckyard-render/broker.sock',
    '/sys/fs/cgroup',
    '/proc/1/root/root/deckyard-render-canary',
  ]) {
    try {
      fs.readFileSync(p);
      denied[p] = 'READ';
    } catch (e) {
      denied[p] = e.code;
    }
  }
  fs.writeFileSync('/tmp/private', 'job');
  finish({
    env: process.env,
    fds: fs.readdirSync('/proc/self/fd').map((fd) => {
      try {
        return [fd, fs.readlinkSync(`/proc/self/fd/${fd}`)];
      } catch {
        return [fd, 'closed'];
      }
    }),
    mounts: fs.readFileSync('/proc/self/mountinfo', 'utf8'),
    devices: fs.readdirSync('/dev'),
    denied,
    tmp: fs.readFileSync('/tmp/private', 'utf8'),
  });
} else if (mode === 'worker') {
  const w = new Worker(
    `const {parentPort}=require('node:worker_threads'); const net=require('node:net'); const s=net.createConnection(80,'127.0.0.1');s.on('error',e=>parentPort.postMessage(e.code));`,
    { eval: true },
  );
  finish(
    await new Promise((resolve, reject) => {
      w.once('message', resolve);
      w.once('error', reject);
    }),
  );
} else if (mode === 'lying-sealed')
  finish('accepted', { runnerId: 'forged', network: true, sealed: false });
else if (mode === 'bad-sealed')
  process.stdout.write(
    JSON.stringify({ ok: true, canvas: 'x', reader: 'x', sealed: null }),
  );
else if (mode === 'extra-identity')
  process.stdout.write(
    JSON.stringify({
      ok: true,
      canvas: 'x',
      reader: 'x',
      sealed: {},
      runnerId: 'forged',
    }),
  );
else if (mode === 'truthy')
  process.stdout.write(
    JSON.stringify({ ok: 1, canvas: 'x', reader: 'x', sealed: {} }),
  );
else if (mode === 'partial') process.stdout.write('{"ok":true,');
else if (mode === 'extra-json')
  process.stdout.write('{"ok":true,"canvas":"x","reader":"x","sealed":{}}{}');
else if (mode === 'failure')
  process.stdout.write(
    '{"ok":false,"code":"renderer_bundle_worker_failed","message":"private canary","details":null}',
  );
else finish({ healthy: true, oldScratch: fs.existsSync('/tmp/private') });
if (mode === 'sleep') finish({ healthy: true });
