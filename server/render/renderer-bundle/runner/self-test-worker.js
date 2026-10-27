// Fixed trusted capability probe, executed after B3 through the same verified
// copy, runtime, executor and cleanup path as an operator job.
import fs from 'node:fs';
import net from 'node:net';
import { Worker } from 'node:worker_threads';
import { SELF_TEST_RESULT } from './policy.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
if (JSON.parse(Buffer.concat(chunks)).schema !== 'deckyard.edition-input/1')
  process.exit(126);
fs.writeFileSync('/tmp/self-test', SELF_TEST_RESULT);
if (fs.readFileSync('/tmp/self-test', 'utf8') !== SELF_TEST_RESULT)
  process.exit(126);
const denied = await new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', (error) => resolve(error.code === 'EPERM'));
  server.listen(0, '0.0.0.0', () => server.close(() => resolve(false)));
});
if (!denied) process.exit(126);
const worker = new Worker(
  "require('node:worker_threads').parentPort.postMessage(42)",
  { eval: true },
);
const value = await new Promise((resolve, reject) => {
  worker.once('message', resolve);
  worker.once('error', reject);
});
await worker.terminate();
if (value !== 42) process.exit(126);
process.stdout.write(
  JSON.stringify({
    ok: true,
    canvas: SELF_TEST_RESULT,
    reader: SELF_TEST_RESULT,
    sealed: {},
  }),
);
