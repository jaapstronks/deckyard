import { workerData, parentPort } from 'node:worker_threads';
import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  chmodSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { openRendererBundle } from '../store.js';
import { loadControl, PATHS, verifyHostLibraries } from './paths.js';
import { OUTPUT_LIMIT, STDERR_LIMIT, validateOutput } from './protocol.js';
import { ociProfile } from './profile.js';

// Exactly one producer operation is accepted by this joinable Worker. No
// message/submit handler exists, and parent completion waits for Worker exit.
const { job, request, config } = workerData;
const directory = `${PATHS.jobs}/${job.id}`;
function freeze(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = lstatSync(p);
    if (s.isDirectory()) freeze(p);
    else if (s.isFile() && s.nlink === 1) chmodSync(p, 0o444);
    else throw new Error('bundle_refused');
  }
  chmodSync(dir, 0o555);
}
async function execute() {
  verifyHostLibraries();
  const copyStore = `${directory}/copy`;
  const bundle = `${copyStore}/${request.rendererHash}`;
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(copyStore, { mode: 0o700 });
  mkdirSync(bundle, { mode: 0o700 });
  try {
    loadControl().copy(`${PATHS.store}/${request.rendererHash}`, bundle);
    await openRendererBundle(copyStore, request.rendererHash);
    freeze(bundle);
  } catch {
    throw new Error('bundle_refused');
  }
  const profile = ociProfile({
    image: config.image,
    bundle,
    jobCgroup: job.guest,
    subuid: config.subuid,
    subgid: config.subgid,
  });
  writeFileSync(`${directory}/config.json`, JSON.stringify(profile), {
    mode: 0o600,
    flag: 'wx',
  });
  parentPort.postMessage({ phase: 'prepared' });
  // The supervisor must durably accept RUNNING before this final start action.
  await new Promise((resolve, reject) => {
    parentPort.once('message', (m) =>
      m === 'run' ? resolve() : reject(new Error('sandbox_unavailable')),
    );
  });
  const child = spawn(
    `${PATHS.install}/launch-runtime`,
    [job.helper, directory, job.id],
    {
      env: {},
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: '/',
    },
  );
  // The single bounded stdout buffer of §2; chunks are not retained twice.
  const output = Buffer.allocUnsafe(OUTPUT_LIMIT);
  let length = 0,
    stderr = 0,
    violation = false;
  child.stdout.on('data', (chunk) => {
    if (violation) return;
    if (length + chunk.length > OUTPUT_LIMIT) {
      violation = true;
      child.stdout.pause();
      child.stderr.pause();
      parentPort.postMessage({ cancel: 'output_limit' });
    } else length += chunk.copy(output, length);
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.length;
    if (stderr > STDERR_LIMIT && !violation) {
      violation = true;
      child.stdout.pause();
      child.stderr.pause();
      parentPort.postMessage({ cancel: 'output_limit' });
    }
  });
  child.stdin.on('error', () => {});
  child.stdin.end(request.input);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (violation) throw new Error('output_limit');
  if (code !== 0) throw new Error('worker_failed');
  try {
    return validateOutput(output.subarray(0, length), request, config.runnerId);
  } catch {
    throw new Error('worker_failed');
  }
}
try {
  const result = await execute();
  // The validated frame moves to the broker thread without a copy.
  parentPort.postMessage({ result }, result.frame ? [result.frame.buffer] : []);
} catch (error) {
  parentPort.postMessage({
    error: ['bundle_refused', 'worker_failed', 'output_limit'].includes(
      error.message,
    )
      ? error.message
      : 'sandbox_unavailable',
  });
} finally {
  parentPort.close();
}
