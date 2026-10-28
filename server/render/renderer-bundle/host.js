/**
 * Production entry: a client of the operator runner's broker socket.
 *
 * Historical renderer code runs only behind the Linux operator runner
 * (`runner/`, docs/ops/renderer-runner.md). This module is the webapp's half of
 * that boundary: one request frame over one Unix socket connection, one
 * response frame back. Without `RENDERER_RUNNER_SOCKET` it refuses before it
 * looks at its arguments. There is no TCP form, no retry and no fallback to
 * the current renderer or to the test-only trusted-fixture runner; whether a
 * refused render is tried again is the publication service's decision.
 */

import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';

import { envStr } from '../../config/utils.js';
import { RENDERER_BUNDLE_ERRORS, RendererBundleError } from './errors.js';
import { isRendererHash } from './manifest.js';
import {
  OUTPUT_LIMIT,
  REQUEST_LIMIT,
  RESPONSE_SCHEMA,
  readFrame,
} from './runner/protocol.js';

/** The one setting that connects this installation to a runner. */
export const RUNNER_SOCKET_ENV = 'RENDERER_RUNNER_SOCKET';

/** Queue expiry (40 s), the whole active job (30 s) and the broker's 5 s
 * read and write deadlines, as one absolute bound on a call. */
export const RUNNER_CALL_TIMEOUT_MS = 80_000;

/** `sun_path` holds 108 bytes including the terminator. */
const SOCKET_PATH_MAX = 107;

/** The runner's framed refusal codes, mapped onto the closed bundle set (A5).
 * Anything not named here, and a closed connection, is the runner being
 * unavailable. */
const WIRE_REFUSALS = Object.freeze({
  bundle_refused: RENDERER_BUNDLE_ERRORS.UNKNOWN,
  worker_failed: RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
  output_limit: RENDERER_BUNDLE_ERRORS.WORKER_FAILED,
  invalid_request: RENDERER_BUNDLE_ERRORS.INPUT_INVALID,
});

const SUCCESS_KEYS = 'canvas,ok,reader,rendererHash,requestId,runnerId,schema';
const REFUSAL_KEYS = 'code,ok,requestId,schema';

const unavailable = (message) =>
  new RendererBundleError(RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE, message);

/**
 * The configured broker socket, or null. Only an absolute filesystem path
 * names a socket; a `host:port` or URL spelling is not a configuration.
 * @returns {string|null}
 */
export function runnerSocketPath() {
  const value = envStr('RENDERER_RUNNER_SOCKET');
  if (
    !value ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    Buffer.byteLength(value) > SOCKET_PATH_MAX
  )
    return null;
  return value;
}

/**
 * Render one edition in the registered bundle `rendererHash`, through the
 * operator runner.
 *
 * @param {string} rendererHash - The bundle's identity
 * @param {import('./edition-input.js').EditionInput} input - The edition input
 * @returns {Promise<{canvas: string, reader: string, rendererHash: string, runnerId: string}>}
 *   `runnerId` is the runtime identity that rendered it (A4); an edition
 *   record keeps it beside the renderer hash.
 * @throws {RendererBundleError} With a code from the closed set: unavailable
 *   (not configured, busy, queue expiry, a closed connection), unknown (the
 *   hash is not registered), worker failed (a guest refusal or an oversized
 *   response), input invalid (the runner refused the envelope), unsealable
 *   (the request is larger than the runner accepts) or a malformed hash.
 */
export async function renderEditionInBundle(rendererHash, input) {
  const socketPath = runnerSocketPath();
  if (!socketPath)
    throw unavailable(
      `Renderer execution requires an OS-isolated runner; set ${RUNNER_SOCKET_ENV} to the runner's broker socket path`,
    );
  if (!isRendererHash(rendererHash))
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.MALFORMED_HASH,
      'renderer hash must be 64 lowercase hex characters',
    );
  const requestId = `edition_${randomBytes(12).toString('hex')}`;
  const body = Buffer.from(
    JSON.stringify({
      schema: 'deckyard.renderer-runner.request/1',
      requestId,
      rendererHash,
      input,
    }),
  );
  if (body.length > REQUEST_LIMIT)
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.UNSEALABLE_INPUT,
      `the edition request is ${body.length} bytes; the runner accepts at most ${REQUEST_LIMIT}`,
      { bytes: body.length, limit: REQUEST_LIMIT },
    );

  const response = await exchange(socketPath, body);
  return readResponse(response, { requestId, rendererHash });
}

/** One frame out, one frame back, within one absolute deadline. */
async function exchange(socketPath, body) {
  const socket = net.createConnection({
    path: socketPath,
    allowHalfOpen: true,
  });
  socket.on('error', () => {});
  const started = performance.now();
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(reject, RUNNER_CALL_TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('close', () => {
        clearTimeout(timer);
        reject();
      });
    });
    const remaining = RUNNER_CALL_TIMEOUT_MS - (performance.now() - started);
    const frame = readFrame(socket, OUTPUT_LIMIT, Math.max(1, remaining));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    socket.end(Buffer.concat([header, body]));
    return await frame;
  } catch {
    throw unavailable(`the renderer runner at ${socketPath} did not answer`);
  } finally {
    socket.destroy();
  }
}

/** Accept exactly the broker's success or refusal envelope for this request. */
function readResponse(bytes, { requestId, rendererHash }) {
  let frame;
  try {
    frame = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw unavailable('the renderer runner answered with a malformed frame');
  }
  const keys =
    frame && typeof frame === 'object' && !Array.isArray(frame)
      ? Object.keys(frame).sort().join(',')
      : '';
  if (frame?.schema !== RESPONSE_SCHEMA || frame.requestId !== requestId)
    throw unavailable('the renderer runner answered another request');
  if (
    keys === SUCCESS_KEYS &&
    frame.ok === true &&
    frame.rendererHash === rendererHash &&
    isRendererHash(frame.runnerId) &&
    typeof frame.canvas === 'string' &&
    typeof frame.reader === 'string'
  )
    return {
      canvas: frame.canvas,
      reader: frame.reader,
      rendererHash,
      runnerId: frame.runnerId,
    };
  if (keys === REFUSAL_KEYS && frame.ok === false) {
    const code = Object.hasOwn(WIRE_REFUSALS, frame.code)
      ? WIRE_REFUSALS[frame.code]
      : RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE;
    throw new RendererBundleError(
      code,
      `the renderer runner refused the edition (${code})`,
      { rendererHash },
    );
  }
  throw unavailable('the renderer runner answered with a malformed frame');
}
