/**
 * The operator installation checks every host path it writes into before its
 * first write (DY-855). A group- or other-writable, foreign-owned or symlinked
 * component refuses the install with the path and the reason, and leaves the
 * host untouched: no directory, file, unit or subordinate-id row.
 *
 * The test runs the real `installRunner` and the real `trustedPath`; only the
 * host is simulated, by replacing `lstatSync` and `geteuid` and recording
 * every fs call that would write. `trustedPath` itself is unchanged: there is
 * no flag or exception, the simulated host only feeds it different metadata.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WRITES = [
  'appendFileSync',
  'chmodSync',
  'chownSync',
  'cpSync',
  'mkdirSync',
  'renameSync',
  'rmSync',
  'writeFileSync',
];

/** A host whose every component is root:root 0755, except the `unsafe` ones. */
function simulateHost(t, unsafe) {
  const writes = [];
  t.mock.method(fs, 'lstatSync', (p) => {
    const bad = unsafe[p] ?? {};
    return {
      uid: bad.uid ?? 0,
      mode: bad.mode ?? 0o40755,
      nlink: 2,
      isSymbolicLink: () => bad.symlink === true,
      isSocket: () => false,
    };
  });
  for (const name of WRITES)
    t.mock.method(fs, name, (...args) => {
      writes.push([name, args[0]]);
    });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(process, 'geteuid', () => 0);
  return writes;
}

async function install() {
  const { installRunner } =
    await import('../server/render/renderer-bundle/runner/operator.js');
  return installRunner('/nonexistent-build', 1500, 1500, 200000);
}

for (const [label, unsafe, message] of [
  [
    'a world-writable /etc/systemd (the CIIIC host)',
    { '/etc/systemd': { mode: 0o40777 } },
    'unsafe runner path: /etc/systemd (mode 777)',
  ],
  [
    'a group-writable /etc/tmpfiles.d',
    { '/etc/tmpfiles.d': { mode: 0o40775 } },
    'unsafe runner path: /etc/tmpfiles.d (mode 775)',
  ],
  [
    'a non-root owner of /var/lib',
    { '/var/lib': { uid: 1000 } },
    'unsafe runner path: /var/lib (owner uid 1000)',
  ],
  [
    'a symlinked /opt',
    { '/opt': { symlink: true } },
    'unsafe runner path: /opt (symlink)',
  ],
  [
    'a writable /etc/subgid',
    { '/etc/subgid': { mode: 0o100666 } },
    'unsafe runner path: /etc/subgid (mode 666)',
  ],
])
  test(`${label} refuses the install before any write`, async (t) => {
    const writes = simulateHost(t, unsafe);
    await assert.rejects(install(), { message });
    assert.deepEqual(writes, []);
  });

test('every install target is checked, including each subordinate-id registry', async () => {
  const { INSTALL_TARGETS } =
    await import('../server/render/renderer-bundle/runner/operator.js');
  for (const p of [
    '/opt',
    '/var/lib',
    '/run',
    '/etc',
    '/etc/systemd/system',
    '/etc/tmpfiles.d',
    '/etc/subuid',
    '/etc/subgid',
  ])
    assert.ok(INSTALL_TARGETS.includes(p), p);
});

test('a safe host passes the check and only then reads the build', async (t) => {
  const writes = simulateHost(t, {});
  await assert.rejects(install(), {
    code: 'ENOENT',
    path: '/nonexistent-build/build.json',
  });
  assert.deepEqual(writes, []);
});

/** The operator CLI in a child process on the simulated CIIIC host. */
function runCli(...args) {
  const preload = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    fs.lstatSync = (p) => ({
      uid: 0,
      mode: p === '/etc/systemd' ? 0o40777 : 0o40755,
      nlink: 2,
      isSymbolicLink: () => false,
      isSocket: () => false,
    });
    syncBuiltinESMExports();
    process.geteuid = () => 0;
  `;
  return spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      fileURLToPath(
        new URL(
          '../server/render/renderer-bundle/runner/index.js',
          import.meta.url,
        ),
      ),
      ...args,
    ],
    { encoding: 'utf8' },
  );
}

test('the install command names the refused path on stderr', () => {
  const run = runCli('install', '/nonexistent-build', '1500', '1500', '200000');
  assert.equal(run.status, 1);
  assert.equal(
    run.stderr,
    'renderer runner refused: unsafe runner path: /etc/systemd (mode 777)\n',
  );
});

test('a service command keeps its fixed journal line', () => {
  const run = runCli('supervisor');
  assert.equal(run.status, 1);
  assert.equal(run.stderr, 'renderer runner refused\n');
});
