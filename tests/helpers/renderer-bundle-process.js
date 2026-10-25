/**
 * Test-only runner for trusted renderer fixtures. NOT a sandbox.
 * Node permissions and import filtering do not prevent network access.
 * Keep reproduction evidence here until an OS-isolated runner is implemented.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

import {
  RENDERER_BUNDLE_ERRORS,
  RendererBundleError,
} from '../../server/render/renderer-bundle/errors.js';

/** Defaults for the resource boundary. Named so a caller can read them back. */
export const RENDER_LIMITS = Object.freeze({
  /** Wall clock for one render. */
  timeoutMs: 30_000,
  /** V8 heap cap for the worker, in MB. */
  heapMb: 512,
  /** Largest document pair the host will buffer, in bytes. */
  maxOutputBytes: 64 * 1024 * 1024,
});

/**
 * The entire environment a render worker gets.
 *
 * Not `{...process.env}` minus a blocklist: an allowlist, because a blocklist
 * of secrets is a list somebody has to remember to extend. `NODE_ENV` is here
 * because libraries branch on it; nothing else is needed to render HTML.
 */
export function workerEnv() {
  return { NODE_ENV: 'production', DECKYARD_RENDER_WORKER: '1' };
}

/**
 * The exact command line a render worker is started with.
 *
 * Exported because the boundary is only worth as much as its proof: the test
 * that measures permission checks and the network escape runs with these
 * same flags, read from here rather than retyped
 * (`tests/renderer-bundle-isolation.test.js`).
 *
 * @param {object} options
 * @param {string} options.script - Absolute path of the script to run
 * @param {string[]} options.readable - Directories the process may read
 * @param {number} [options.heapMb] - V8 heap cap
 * @returns {string[]} Arguments after the node binary
 */
export function rendererWorkerArgs({
  script,
  readable,
  heapMb = RENDER_LIMITS.heapMb,
}) {
  return [
    '--permission',
    ...readable.map((dir) => `--allow-fs-read=${dir}`),
    `--max-old-space-size=${heapMb}`,
    script,
  ];
}

/**
 * Render one edition inside an opened bundle.
 *
 * @param {import('../../server/render/renderer-bundle/store.js').OpenRendererBundle} bundle - From
 *   `openRendererBundle()`, so its bytes are already verified
 * @param {object} input - The frozen edition input
 * @param {object} [limits] - Overrides for {@link RENDER_LIMITS}
 * @returns {Promise<{canvas: string, reader: string, sealed: object}>}
 * @throws {RendererBundleError} On a refusal from the entry, a crash, a
 *   timeout or an oversized document. Never a fallback render.
 */
export async function renderTrustedEditionForProof(bundle, input, limits = {}) {
  const { timeoutMs, heapMb, maxOutputBytes } = { ...RENDER_LIMITS, ...limits };
  const workerPath = path.join(bundle.filesDir, bundle.manifest.worker);

  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      rendererWorkerArgs({
        script: workerPath,
        readable: [bundle.dir],
        heapMb,
      }),
      { cwd: bundle.dir, env: workerEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let out = '';
    let err = '';
    let outBytes = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(
        reject,
        new RendererBundleError(
          RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
          `render bundle ${bundle.rendererHash} did not finish within ${timeoutMs} ms`,
          { rendererHash: bundle.rendererHash, timeoutMs },
        ),
      );
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      outBytes += Buffer.byteLength(chunk);
      if (outBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        finish(
          reject,
          new RendererBundleError(
            RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
            `render bundle ${bundle.rendererHash} wrote more than ${maxOutputBytes} bytes`,
            { rendererHash: bundle.rendererHash },
          ),
        );
        return;
      }
      out += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (err.length < 8192) err += chunk;
    });

    child.on('error', (cause) =>
      finish(
        reject,
        new RendererBundleError(
          RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
          `render bundle ${bundle.rendererHash} could not be started: ${cause.message}`,
        ),
      ),
    );
    child.on('close', (code, signal) => {
      if (code === 0) {
        finish(resolve, out);
        return;
      }
      finish(
        reject,
        new RendererBundleError(
          RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
          `render bundle ${bundle.rendererHash} exited with ${signal || code}: ${err.trim().slice(0, 500)}`,
          { rendererHash: bundle.rendererHash, code, signal },
        ),
      );
    });

    child.stdin.on('error', () => {
      // The worker can refuse and exit before stdin is drained; the close
      // handler above is what reports that, not an EPIPE here.
    });
    child.stdin.end(JSON.stringify(input));
  });

  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
      `render bundle ${bundle.rendererHash} wrote something that is not JSON`,
      { rendererHash: bundle.rendererHash },
    );
  }
  if (!parsed?.ok) {
    throw new RendererBundleError(
      parsed?.code || RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
      parsed?.message || 'the render worker refused without a reason',
      parsed?.details ?? null,
    );
  }
  return {
    canvas: parsed.canvas,
    reader: parsed.reader,
    sealed: parsed.sealed,
  };
}
