import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  lstatSync,
  chmodSync,
  chownSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
import { sha256Hex, isRendererHash } from '../manifest.js';
import { openRendererBundle } from '../store.js';
import {
  inventory,
  NODE_DIGEST,
  CRUN_DIGEST,
  HOST_LIBRARIES,
} from './build.js';
import { PATHS, loadInstallation, loadControl } from './paths.js';
import { saveLedger } from './ledger.js';
import {
  readFrame,
  OUTPUT_LIMIT,
  validateRequest,
  parseJson,
} from './protocol.js';

const source = path.dirname(fileURLToPath(import.meta.url));
function freeze(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name),
      s = lstatSync(p);
    if (s.isDirectory()) freeze(p);
    else if (s.isFile() && s.nlink === 1) {
      chownSync(p, 0, 0);
      chmodSync(p, 0o444);
    } else throw new Error('registration alias');
  }
  chmodSync(dir, 0o555);
}

/** Fresh, explicit operator installation. No start/enable, updates or repair
 * defaults. Reserve a dedicated mapping in both subordinate-id registries. */
export async function installRunner(build, callerUid, callerGid, subid) {
  if (
    process.geteuid() !== 0 ||
    !Number.isSafeInteger(callerUid) ||
    callerUid <= 0 ||
    callerUid >= 4294967295 ||
    !Number.isSafeInteger(callerGid) ||
    callerGid <= 0 ||
    callerGid >= 4294967295 ||
    !Number.isSafeInteger(subid) ||
    subid < 100000 ||
    subid + 65536 >= 4294967295
  )
    throw new Error('invalid operator identities');
  const lock = JSON.parse(readFileSync(`${build}/build.json`, 'utf8'));
  if (
    lock.schema !== 'deckyard.renderer-runner.build/1' ||
    JSON.stringify(lock.hostLibraries) !== JSON.stringify(HOST_LIBRARIES) ||
    lock.node !== NODE_DIGEST ||
    lock.crun !== CRUN_DIGEST ||
    JSON.stringify(inventory(`${build}/image`)) !==
      JSON.stringify(lock.image) ||
    JSON.stringify(inventory(`${build}/self-test`)) !==
      JSON.stringify(lock.selfTest) ||
    !isRendererHash(lock.selfTestHash)
  )
    throw new Error('image build pin mismatch');
  for (const [file, digest] of [
    ['crun', lock.crun],
    ['control.node', lock.control],
    ['launch-runtime', lock.launcher],
  ]) {
    if (sha256Hex(readFileSync(`${build}/${file}`)) !== digest)
      throw new Error('native build pin mismatch');
  }
  // Test the kernel socket capability before installation, not after exposing
  // admission. SO_PEERPIDFD is mandatory; no PID-only fallback.
  createRequire(import.meta.url)(`${build}/control.node`);
  for (const registry of ['/etc/subuid', '/etc/subgid']) {
    const rows = readFileSync(registry, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const row of rows) {
      const [owner, start, count] = row.split(':');
      if (
        owner === 'deckyard-render' ||
        (subid < +start + +count && +start < subid + 65536)
      )
        throw new Error('subordinate range already reserved');
    }
  }
  for (const registry of ['/etc/passwd', '/etc/group']) {
    if (
      readFileSync(registry, 'utf8')
        .split('\n')
        .filter(Boolean)
        .some((row) => {
          const n = +row.split(':')[2];
          return n >= subid && n < subid + 65536;
        })
    )
      throw new Error('mapping overlaps host identity');
  }
  const units = [
    'deckyard-render-broker.service',
    'deckyard-render-supervisor.service',
  ];
  for (const p of [
    PATHS.install,
    PATHS.state,
    PATHS.run,
    PATHS.config,
    '/etc/tmpfiles.d/deckyard-render.conf',
    ...units.map((u) => `/etc/systemd/system/${u}`),
  ]) {
    if (existsSync(p)) throw new Error('fresh installation only');
  }
  process.umask(0o022);
  mkdirSync(PATHS.install, { mode: 0o755 });
  for (const name of [
    'image',
    'crun',
    'control.node',
    'launch-runtime',
    'self-test',
  ])
    cpSync(`${build}/${name}`, `${PATHS.install}/${name}`, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  chmodSync(`${PATHS.install}/launch-runtime`, 0o555);
  const code = `${PATHS.install}/code`;
  mkdirSync(code);
  cpSync(source, `${code}/runner`, { recursive: true });
  for (const name of [
    'manifest.js',
    'store.js',
    'edition-input.js',
    'errors.js',
  ])
    cpSync(`${source}/../${name}`, `${code}/${name}`);
  writeFileSync(`${PATHS.install}/package.json`, '{"type":"module"}\n');
  function protect(dir) {
    chownSync(dir, 0, 0);
    chmodSync(dir, 0o755);
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name),
        s = lstatSync(p);
      if (s.isDirectory()) protect(p);
      else if (s.isFile() && s.nlink === 1) {
        chownSync(p, 0, 0);
        chmodSync(p, 0o444);
      } else throw new Error('installation source alias');
    }
  }
  protect(code);
  for (const entry of inventory(PATHS.install))
    chownSync(`${PATHS.install}/${entry.path}`, 0, 0);
  for (const p of [
    PATHS.state,
    PATHS.jobs,
    PATHS.store,
    PATHS.run,
    PATHS.runtime,
    PATHS.private,
  ])
    mkdirSync(p, { mode: p === PATHS.run ? 0o750 : 0o700 });
  chownSync(PATHS.run, 0, callerGid);
  const serviceFiles = {};
  for (const unit of units) {
    const dest = `/etc/systemd/system/${unit}`;
    const bytes = readFileSync(`${source}/units/${unit}`);
    writeFileSync(dest, bytes, { mode: 0o644, flag: 'wx' });
    serviceFiles[dest] = sha256Hex(bytes);
  }
  const tmpfiles = `d ${PATHS.run} 0750 root ${callerGid} -\nd ${PATHS.runtime} 0700 root root -\nd ${PATHS.private} 0700 root root -\n`;
  writeFileSync('/etc/tmpfiles.d/deckyard-render.conf', tmpfiles, {
    mode: 0o644,
    flag: 'wx',
  });
  serviceFiles['/etc/tmpfiles.d/deckyard-render.conf'] = sha256Hex(tmpfiles);
  for (const registry of ['/etc/subuid', '/etc/subgid'])
    writeFileSync(registry, `deckyard-render:${subid}:65536\n`, { flag: 'a' });
  const config = {
    schema: 'deckyard.renderer-runner.installation/1',
    installation: randomBytes(16).toString('hex'),
    callerUid,
    callerGid,
    subuid: subid,
    subgid: subid,
    build: lock,
    files: inventory(PATHS.install),
    serviceFiles,
  };
  writeFileSync(PATHS.config, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  saveLedger({
    schema: 'deckyard.renderer-runner.ledger/1',
    installation: config.installation,
    generation: randomBytes(16).toString('hex'),
    instance: null,
    jobs: [],
  });
  await registerBundle(`${PATHS.install}/self-test`, lock.selfTestHash);
  execFileSync('/usr/bin/systemctl', ['daemon-reload']);
  process.stdout.write(
    'Operator runner installed, services stopped. Production host remains disabled.\n',
  );
}

/** Register by a private bounded copy and total verification, then atomic
 * publication. Root operators can add content, callers cannot. */
export async function registerBundle(sourceStore, hash) {
  loadInstallation();
  if (!isRendererHash(hash) || existsSync(`${PATHS.store}/${hash}`))
    throw new Error('registration refused');
  const candidate = `${PATHS.store}/.candidate-${randomBytes(16).toString('hex')}`;
  mkdirSync(candidate, { mode: 0o700 });
  mkdirSync(`${candidate}/${hash}`, { mode: 0o700 });
  try {
    loadControl().copy(`${sourceStore}/${hash}`, `${candidate}/${hash}`);
    await openRendererBundle(candidate, hash);
    freeze(`${candidate}/${hash}`);
    renameSync(`${candidate}/${hash}`, `${PATHS.store}/${hash}`);
  } finally {
    rmSync(candidate, { recursive: true, force: true });
  }
}

/** Explicit caller path. The same configured UID can read its own request but
 * cannot read the root-only installation config, state or supervisor socket. */
export async function callRunner(requestFile) {
  const bytes = readFileSync(requestFile);
  validateRequest(parseJson(bytes));
  const socket = net.createConnection({
    path: PATHS.socket,
    allowHalfOpen: true,
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const response = readFrame(socket, OUTPUT_LIMIT, 80000);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length);
  socket.end(Buffer.concat([header, bytes]));
  try {
    process.stdout.write(`${(await response).toString('utf8')}\n`);
  } finally {
    socket.destroy();
  }
}
