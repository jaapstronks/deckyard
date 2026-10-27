import { TextDecoder } from 'node:util';
import { EDITION_INPUT_SCHEMA } from '../edition-input.js';
import { isRendererHash } from '../manifest.js';
import { RENDERER_BUNDLE_ERRORS } from '../errors.js';

export const REQUEST_LIMIT = 16 * 1024 * 1024;
export const OUTPUT_LIMIT = 64 * 1024 * 1024;
export const STDERR_LIMIT = 1024 * 1024;
export const RESPONSE_SCHEMA = 'deckyard.renderer-runner.response/1';
export const CODES = Object.freeze([
  'invalid_request',
  'unauthorized',
  'busy',
  'queue_timeout',
  'bundle_refused',
  'sandbox_unavailable',
  'job_timeout',
  'job_cancelled',
  'worker_failed',
  'output_limit',
]);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) =>
  object(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));

/** Strict UTF-8 JSON, including duplicate keys at every depth. Depth is bounded
 * before JSON.parse, which also keeps pathological inputs inside admission. */
export function parseJson(bytes) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let i = 0;
  const whitespace = () => {
    while (/[\t\r\n ]/.test(source[i] || '\0')) i++;
  };
  function string() {
    const start = i++;
    while (i < source.length) {
      const c = source[i++];
      if (c === '"') return JSON.parse(source.slice(start, i));
      if (c === '\\') i++;
    }
    throw new Error('invalid_request');
  }
  function value(depth) {
    if (depth > 64) throw new Error('invalid_request');
    whitespace();
    const c = source[i];
    if (c === '"') {
      string();
      return;
    }
    if (c === '{' || c === '[') {
      const end = c === '{' ? '}' : ']';
      const keys = new Set();
      i++;
      whitespace();
      if (source[i] === end) {
        i++;
        return;
      }
      for (;;) {
        whitespace();
        if (c === '{') {
          if (source[i] !== '"') throw new Error('invalid_request');
          const key = string();
          if (keys.has(key)) throw new Error('invalid_request');
          keys.add(key);
          whitespace();
          if (source[i++] !== ':') throw new Error('invalid_request');
        }
        value(depth + 1);
        whitespace();
        if (source[i] === end) {
          i++;
          return;
        }
        if (source[i++] !== ',') throw new Error('invalid_request');
      }
    }
    const start = i;
    while (i < source.length && !/[\s,\]}]/.test(source[i])) i++;
    if (start === i) throw new Error('invalid_request');
    JSON.parse(source.slice(start, i));
  }
  value(0);
  whitespace();
  if (i !== source.length) throw new Error('invalid_request');
  return JSON.parse(source);
}

/** Validate the closed caller envelope without importing historical code. */
export function validateRequest(v) {
  if (
    !exact(v, ['schema', 'requestId', 'rendererHash', 'input']) ||
    v.schema !== 'deckyard.renderer-runner.request/1' ||
    typeof v.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(v.requestId) ||
    !isRendererHash(v.rendererHash) ||
    !object(v.input) ||
    v.input.schema !== EDITION_INPUT_SCHEMA ||
    !object(v.input.presentation) ||
    !Array.isArray(v.input.presentation.slides)
  ) {
    throw new Error('invalid_request');
  }
  return v;
}

/** Discard all guest metadata. A valid sealed object is diagnostic data only. */
export function validateOutput(bytes) {
  const v = parseJson(bytes);
  if (
    exact(v, ['ok', 'canvas', 'reader', 'sealed']) &&
    v.ok === true &&
    typeof v.canvas === 'string' &&
    typeof v.reader === 'string' &&
    object(v.sealed)
  ) {
    return { canvas: v.canvas, reader: v.reader };
  }
  if (
    exact(v, ['ok', 'code', 'message', 'details']) &&
    v.ok === false &&
    Object.values(RENDERER_BUNDLE_ERRORS).includes(v.code) &&
    typeof v.message === 'string' &&
    (v.details === null || object(v.details))
  )
    throw new Error('worker_failed');
  throw new Error('worker_failed');
}

// Count JSON string bytes before allocating an escaped 6x copy. In particular,
// a guest-controlled control-character string must produce output_limit inside
// the broker's memory budget, rather than relying on the OOM boundary.
function escapedBytes(value) {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 34 || c === 92 || [8, 9, 10, 12, 13].includes(c)) bytes += 2;
    else if (c < 32) bytes += 6;
    else if (c < 128) bytes++;
    else if (c < 2048) bytes += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      value.charCodeAt(i + 1) >= 0xdc00 &&
      value.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else if (c >= 0xd800 && c <= 0xdfff) bytes += 6;
    else bytes += 3;
    if (bytes > OUTPUT_LIMIT) return bytes;
  }
  return bytes;
}

/** A framed response; serialization overhead is covered by the body limit. */
export function responseBytes(request, outcome, runnerId) {
  const base = {
    schema: RESPONSE_SCHEMA,
    requestId: request?.requestId ?? null,
  };
  let v = outcome.code
    ? {
        ...base,
        ok: false,
        code: CODES.includes(outcome.code)
          ? outcome.code
          : 'sandbox_unavailable',
      }
    : {
        ...base,
        ok: true,
        rendererHash: request.rendererHash,
        runnerId,
        canvas: outcome.canvas,
        reader: outcome.reader,
      };
  if (!outcome.code) {
    const overhead = Buffer.byteLength(
      JSON.stringify({ ...v, canvas: '', reader: '' }),
    );
    if (
      overhead + escapedBytes(v.canvas) + escapedBytes(v.reader) >
      OUTPUT_LIMIT
    )
      v = { ...base, ok: false, code: 'output_limit' };
  }
  let body = Buffer.from(JSON.stringify(v));
  if (body.length > OUTPUT_LIMIT)
    body = Buffer.from(
      JSON.stringify({ ...base, ok: false, code: 'output_limit' }),
    );
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

/** Read one frame and EOF against one absolute deadline. Call only after peer
 * authorization. The caller owns the connection token until this settles. */
export function readFrame(socket, limit = REQUEST_LIMIT, milliseconds = 5000) {
  return new Promise((resolve, reject) => {
    const header = Buffer.alloc(4);
    let head = 0,
      body = null,
      offset = 0,
      settled = false;
    const timer = setTimeout(
      () => finish(new Error('invalid_request')),
      milliseconds,
    );
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('data', data);
      socket.off('end', end);
      socket.off('error', failure);
      socket.off('close', closed);
      if (error) {
        socket.pause();
        reject(error);
      } else resolve(body);
    }
    const failure = () => finish(new Error('job_cancelled'));
    const closed = () => finish(new Error('job_cancelled'));
    const end = () =>
      finish(
        body && offset === body.length ? null : new Error('invalid_request'),
      );
    function data(chunk) {
      let start = 0;
      if (head < 4) {
        const count = Math.min(4 - head, chunk.length);
        chunk.copy(header, head, 0, count);
        head += count;
        start += count;
        if (head === 4) {
          const length = header.readUInt32BE();
          if (!length || length > limit) {
            finish(new Error('invalid_request'));
            return;
          }
          body = Buffer.alloc(length);
        }
      }
      if (body) {
        if (chunk.length - start > body.length - offset) {
          finish(new Error('invalid_request'));
          return;
        }
        chunk.copy(body, offset, start);
        offset += chunk.length - start;
      }
    }
    socket.on('data', data);
    socket.once('end', end);
    socket.once('error', failure);
    socket.once('close', closed);
    socket.resume();
  });
}
