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

/** Strict UTF-8 JSON grammar, including duplicate keys at every depth and a
 * byte-order mark. Depth is bounded before any tree is built. Values are not
 * materialised: the scan returns character offsets, and only the members named
 * in `want` (a nested key map) record their own offsets for the caller. */
function scan(bytes, want = null) {
  const source = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
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
  // `wanted` is null for an unrecorded value, true for a recorded leaf, or a
  // key map whose members are recorded too. Unrecorded values allocate nothing.
  function value(depth, wanted) {
    if (depth > 64) throw new Error('invalid_request');
    whitespace();
    const start = i,
      c = source[i];
    let keys = 0,
      members = null;
    if (c === '"') string();
    else if (c === '{' || c === '[') {
      const end = c === '{' ? '}' : ']';
      const seen = new Set();
      if (wanted && wanted !== true) members = new Map();
      i++;
      whitespace();
      if (source[i] === end) i++;
      else
        for (;;) {
          whitespace();
          let inner = null;
          if (c === '{') {
            if (source[i] !== '"') throw new Error('invalid_request');
            const key = string();
            if (seen.has(key)) throw new Error('invalid_request');
            seen.add(key);
            keys++;
            whitespace();
            if (source[i++] !== ':') throw new Error('invalid_request');
            if (members && Object.hasOwn(wanted, key))
              members.set(key, (inner = value(depth + 1, wanted[key])));
          }
          if (!inner) value(depth + 1, null);
          whitespace();
          if (source[i] === end) {
            i++;
            break;
          }
          if (source[i++] !== ',') throw new Error('invalid_request');
        }
    } else {
      while (i < source.length && !/[\s,\]}]/.test(source[i])) i++;
      if (start === i) throw new Error('invalid_request');
      JSON.parse(source.slice(start, i));
    }
    return wanted ? { start, end: i, keys, members } : null;
  }
  const root = value(0, want ?? true);
  whitespace();
  if (i !== source.length) throw new Error('invalid_request');
  return { source, root };
}

/** Strict JSON for small lifecycle frames and the bounded guest output. */
export function parseJson(bytes) {
  return JSON.parse(scan(bytes).source);
}

/** ASCII correlation identifier; final line terminators are not identifiers. */
export function isRequestId(value) {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    !/[^A-Za-z0-9_-]/.test(value)
  );
}

const REQUEST_MEMBERS = Object.freeze({
  schema: true,
  requestId: true,
  rendererHash: true,
  input: { schema: true, presentation: { slides: true } },
});

/** Validate the closed caller envelope without importing historical code or
 * building the input tree. Only the envelope scalars are parsed; the input
 * stays the caller's own validated JSON bytes, so a queued request costs at
 * most its 16 MiB body (§2). A refusal carries a decodable requestId. */
export function parseRequest(bytes) {
  let scanned;
  try {
    scanned = scan(bytes, REQUEST_MEMBERS);
  } catch {
    throw Object.assign(new Error('invalid_request'), { requestId: null });
  }
  const { source, root } = scanned;
  const kind = (node) => source[node?.start];
  const text = (node) => source.slice(node.start, node.end);
  const scalar = (node) =>
    node && kind(node) !== '{' && kind(node) !== '['
      ? JSON.parse(text(node))
      : undefined;
  const members = root.members;
  const requestId = scalar(members?.get('requestId'));
  const input = members?.get('input');
  const presentation = input?.members?.get('presentation');
  if (
    kind(root) !== '{' ||
    root.keys !== 4 ||
    members.size !== 4 ||
    scalar(members.get('schema')) !== 'deckyard.renderer-runner.request/1' ||
    !isRequestId(requestId) ||
    !isRendererHash(scalar(members.get('rendererHash'))) ||
    kind(input) !== '{' ||
    scalar(input.members.get('schema')) !== EDITION_INPUT_SCHEMA ||
    kind(presentation) !== '{' ||
    kind(presentation.members.get('slides')) !== '['
  )
    throw Object.assign(new Error('invalid_request'), {
      requestId: isRequestId(requestId) ? requestId : null,
    });
  return {
    schema: 'deckyard.renderer-runner.request/1',
    requestId,
    rendererHash: scalar(members.get('rendererHash')),
    input: Buffer.from(text(input)),
  };
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
  let json = JSON.stringify(v),
    length = Buffer.byteLength(json);
  if (length > OUTPUT_LIMIT) {
    json = JSON.stringify({ ...base, ok: false, code: 'output_limit' });
    length = Buffer.byteLength(json);
  }
  // One allocation for header and body: no second 64 MiB copy in the broker.
  const framed = Buffer.allocUnsafe(4 + length);
  framed.writeUInt32BE(length);
  framed.write(json, 4);
  return framed;
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
