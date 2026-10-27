// Trusted image entry. No historical import is evaluated before activate().
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { PROC_MASKS, MOUNT_FLAGS } from './policy.js';
const require = createRequire(import.meta.url);
function refuse() {
  process.exit(126);
}
if (
  process.arch !== 'x64' ||
  process.platform !== 'linux' ||
  JSON.stringify(Object.entries(process.env).sort()) !==
    JSON.stringify([
      ['DECKYARD_RENDER_WORKER', '1'],
      ['NODE_ENV', 'production'],
    ])
)
  refuse();
if (process.getuid() !== 1000 || process.getgid() !== 1000) refuse();
const mounts = readFileSync('/proc/self/mountinfo', 'utf8')
  .trim()
  .split('\n')
  .map((line) => {
    const [front, back] = line.split(' - '),
      fields = front.split(' '),
      filesystem = back.split(' ');
    return {
      destination: fields[4],
      options: fields[5].split(','),
      type: filesystem[0],
      superOptions: filesystem[2].split(','),
    };
  });
const permitted = new Set([
  '/',
  '/bundle',
  '/dev',
  '/proc',
  '/tmp',
  '/dev/null',
  '/dev/zero',
  '/dev/urandom',
  ...PROC_MASKS,
]);
if (mounts.some((mount) => !permitted.has(mount.destination))) refuse();
for (const destination of ['/', '/bundle', '/dev', '/proc', '/tmp']) {
  const found = mounts.filter((mount) => mount.destination === destination);
  if (found.length !== 1) refuse();
  const required =
    destination === '/'
      ? ['ro']
      : MOUNT_FLAGS[destination].filter((flag) =>
          ['ro', 'nosuid', 'nodev', 'noexec'].includes(flag),
        );
  if (!required.every((flag) => found[0].options.includes(flag))) refuse();
  if (
    destination === '/tmp' &&
    (found[0].type !== 'tmpfs' ||
      !found[0].superOptions.includes('size=65536k'))
  )
    refuse();
}
for (const destination of [
  '/proc/kcore',
  '/proc/keys',
  '/proc/timer_list',
  '/proc/interrupts',
  '/proc/sysrq-trigger',
  '/proc/sys',
]) {
  if (
    !mounts.some(
      (mount) =>
        mount.destination === destination && mount.options.includes('ro'),
    )
  )
    refuse();
}
if (
  JSON.stringify(readdirSync('/dev').sort()) !==
  JSON.stringify(['fd', 'null', 'stderr', 'stdin', 'stdout', 'urandom', 'zero'])
)
  refuse();
const native = require('/opt/runner/bootstrap.node');
// Runtime closes inherited FDs; these are Node's own internal primitives. No
// socket, ring, host file or management descriptor can cross B4.
for (const name of readdirSync('/proc/self/fd')) {
  let link;
  try {
    link = readlinkSync(`/proc/self/fd/${name}`);
  } catch (e) {
    if (e.code === 'ENOENT') continue;
    throw e;
  }
  if (+name <= 2) {
    if (!/^pipe:\[\d+\]$/.test(link)) refuse();
    continue;
  }
  if (
    !/^pipe:\[\d+\]$/.test(link) &&
    link !== 'anon_inode:[eventpoll]' &&
    link !== 'anon_inode:[eventfd]' &&
    link !== '/dev/null'
  )
    refuse();
}
if (native.activate() !== true) refuse();
const manifest = JSON.parse(readFileSync('/bundle/manifest.json', 'utf8'));
await import(`/bundle/files/${manifest.worker}`);
