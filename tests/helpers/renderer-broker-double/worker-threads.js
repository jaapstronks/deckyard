/**
 * Stand-in for `node:worker_threads` under the broker double. The producer
 * Worker is the one part that needs root, crun and a registered copy; this one
 * answers the way a job worker does after a clean run: `prepared`, then on
 * `run` a result validated by the shipped `validateOutput`, then exit 0. The
 * self-test answers its own marker. Each construction is reported on stdout,
 * so the test can count jobs.
 */

import { EventEmitter } from 'node:events';

import { validateOutput } from '../../../server/render/renderer-bundle/protocol.js';
import { SELF_TEST_RESULT } from '../../../server/render/renderer-bundle/runner/policy.js';

export class Worker extends EventEmitter {
  constructor(_url, { workerData }) {
    super();
    this.request = workerData.request;
    this.runnerId = workerData.config.runnerId;
    process.stdout.write(
      `${JSON.stringify({ worker: this.request.requestId })}\n`,
    );
    setImmediate(() => this.emit('message', { phase: 'prepared' }));
  }

  postMessage(message) {
    if (message !== 'run') return;
    const internal = this.request.requestId === 'runner-self-test';
    const text = internal
      ? SELF_TEST_RESULT
      : `rendered ${this.request.rendererHash}`;
    const output = Buffer.from(
      JSON.stringify({ ok: true, canvas: text, reader: text, sealed: {} }),
    );
    const result = validateOutput(output, this.request, this.runnerId);
    setImmediate(() => {
      this.emit('message', { result: { ...result, output } });
      this.emit('exit', 0);
    });
  }
}
