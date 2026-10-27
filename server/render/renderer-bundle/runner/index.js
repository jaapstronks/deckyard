#!/usr/bin/env node
// Explicit operator entry only. No web, v1 or MCP consumer imports this seam.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Operator CLI. Installation and registration never activate production. */
export async function runnerCommand(args) {
  const [command, ...rest] = args;
  if (command === 'build' && rest.length === 2) {
    const { buildRunner } = await import('./build.js');
    buildRunner(path.resolve(rest[0]), path.resolve(rest[1]));
  } else if (command === 'supervisor' && !rest.length) {
    const { startSupervisor } = await import('./supervisor.js');
    await startSupervisor();
  } else if (command === 'broker' && !rest.length) {
    const { startBroker } = await import('./broker.js');
    await startBroker();
  } else if (command === 'install' && rest.length === 4) {
    const { installRunner } = await import('./operator.js');
    await installRunner(path.resolve(rest[0]), ...rest.slice(1).map(Number));
  } else if (command === 'register' && rest.length === 2) {
    const { registerBundle } = await import('./operator.js');
    await registerBundle(path.resolve(rest[0]), rest[1]);
  } else if (command === 'call' && rest.length === 1) {
    const { callRunner } = await import('./operator.js');
    await callRunner(path.resolve(rest[0]));
  } else
    throw new Error(
      'usage: runner/index.js build <new-directory> <pinned-crun> | install <build> <caller-uid> <caller-gid> <subid-start> | register <source-store> <renderer-hash> | call <request-file> | supervisor | broker',
    );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runnerCommand(process.argv.slice(2));
  } catch {
    process.stderr.write('renderer runner refused\n');
    process.exitCode = 1;
  }
}
