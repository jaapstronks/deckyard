import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sha256Hex } from '../manifest.js';
import { inventory, HOST_LIBRARIES } from './build.js';
import { runnerIdentity } from './identity.js';

export const PATHS = Object.freeze({
  install: '/opt/deckyard-render',
  config: '/etc/deckyard-render.json',
  state: '/var/lib/deckyard-render',
  jobs: '/var/lib/deckyard-render/jobs',
  store: '/var/lib/deckyard-render/store',
  register: '/var/lib/deckyard-render/register.json',
  run: '/run/deckyard-render',
  runtime: '/run/deckyard-render/runtime',
  socket: '/run/deckyard-render/broker.sock',
  private: '/run/deckyard-render/private',
  supervisor: '/run/deckyard-render/private/supervisor.sock',
});

/** Walk all trusted parent components. No symlink or caller-writable path. */
export function trustedPath(absolute, mode = null) {
  let current = '';
  for (const part of absolute.split('/').filter(Boolean)) {
    current += `/${part}`;
    const s = lstatSync(current);
    if (
      s.isSymbolicLink() ||
      s.uid !== 0 ||
      s.mode & (current === absolute && s.isSocket() ? 0o002 : 0o022) ||
      s.nlink < 1
    )
      throw new Error('unsafe runner path');
  }
  const s = lstatSync(absolute);
  if (mode !== null && (s.mode & 0o777) !== mode)
    throw new Error('unsafe runner mode');
  return s;
}

/** Installed operator config is immutable for a service invocation. All code,
 * runtime, native and image bytes are bound into the broker-owned runnerId. */
export function loadInstallation() {
  if (
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    process.geteuid() !== 0
  )
    throw new Error('sandbox_unavailable');
  trustedPath(PATHS.config, 0o600);
  const config = JSON.parse(readFileSync(PATHS.config, 'utf8'));
  if (
    config.schema !== 'deckyard.renderer-runner.installation/1' ||
    !Number.isInteger(config.callerUid) ||
    config.callerUid <= 0 ||
    !Number.isInteger(config.callerGid) ||
    config.callerGid <= 0 ||
    !Number.isInteger(config.subuid) ||
    config.subuid < 100000 ||
    !Number.isInteger(config.subgid) ||
    config.subgid < 100000 ||
    (config.callerUid >= config.subuid &&
      config.callerUid < config.subuid + 65536)
  )
    throw new Error('invalid runner installation');
  for (const p of [
    PATHS.install,
    PATHS.state,
    PATHS.store,
    PATHS.jobs,
    PATHS.run,
    PATHS.runtime,
    PATHS.private,
  ])
    trustedPath(p);
  for (const [file, digest] of Object.entries(config.serviceFiles)) {
    trustedPath(file);
    if (sha256Hex(readFileSync(file)) !== digest)
      throw new Error('runner service policy changed');
  }
  if (
    JSON.stringify(config.build.hostLibraries) !==
    JSON.stringify(HOST_LIBRARIES)
  )
    throw new Error('host library policy changed');
  for (const [file, digest] of Object.entries(HOST_LIBRARIES)) {
    trustedPath(realpathSync(file));
    if (sha256Hex(readFileSync(file)) !== digest)
      throw new Error('host library changed');
  }
  for (const entry of config.files)
    trustedPath(`${PATHS.install}/${entry.path}`);
  for (const p of [
    PATHS.state,
    PATHS.store,
    PATHS.jobs,
    PATHS.runtime,
    PATHS.private,
  ])
    trustedPath(p, 0o700);
  if (trustedPath(PATHS.run, 0o750).gid !== config.callerGid)
    throw new Error('runner group changed');
  if (JSON.stringify(inventory(PATHS.install)) !== JSON.stringify(config.files))
    throw new Error('runner installation changed');
  return {
    ...config,
    runnerId: runnerIdentity(config),
    image: `${PATHS.install}/image`,
  };
}

/** Native control is loaded only by explicit operator/service entrypoints. */
export function loadControl() {
  return createRequire(import.meta.url)(`${PATHS.install}/control.node`);
}
