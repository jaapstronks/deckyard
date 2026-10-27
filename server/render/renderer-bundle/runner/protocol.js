import { TextDecoder } from 'node:util';
import { EDITION_INPUT_SCHEMA } from '../edition-input.js';
import { isRendererHash } from '../manifest.js';

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
  // Validates one string token in place. Only keys are decoded (for duplicate
  // detection); a value token is never copied, however long it is.
  function string(decode) {
    const start = i++;
    for (;;) {
      if (i >= source.length) throw new Error('invalid_request');
      const c = source.charCodeAt(i++);
      if (c === 0x22) break;
      if (c < 0x20) throw new Error('invalid_request');
      if (c === 0x5c) {
        const e = source[i++];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(i, i + 4)))
            throw new Error('invalid_request');
          i += 4;
        } else if (e === undefined || !'"\\/bfnrt'.includes(e))
          throw new Error('invalid_request');
      }
    }
    return decode ? JSON.parse(source.slice(start, i)) : null;
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
    if (c === '"') string(false);
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
            const key = string(true);
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

const OUTPUT_MEMBERS = Object.freeze({
  ok: true,
  canvas: true,
  reader: true,
  sealed: true,
  code: true,
  message: true,
  details: true,
});

/** Validate one complete guest answer and frame the broker's success response
 * from it, discarding all guest metadata (a valid `sealed` object is diagnostic
 * data only). The canvas and reader values are copied as their own string
 * tokens: the strict scan proved them complete JSON strings, so no decoded
 * copies of up to 64 MiB are built and nothing else of the guest can reach the
 * caller. Returns `{frame}` with its own transferable ArrayBuffer, or `{code}`
 * when the serialized response would exceed the 64 MiB limit. */
export function validateOutput(bytes, request, runnerId) {
  let scanned;
  try {
    scanned = scan(bytes, OUTPUT_MEMBERS);
  } catch {
    throw new Error('worker_failed');
  }
  const { source, root } = scanned;
  const m = root.members;
  const kind = (node) => source[node?.start];
  const text = (node) => source.slice(node.start, node.end);
  if (kind(root) !== '{' || root.keys !== 4 || m.size !== 4)
    throw new Error('worker_failed');
  const [ok, canvas, reader] = ['ok', 'canvas', 'reader'].map((k) => m.get(k));
  if (
    ok &&
    text(ok) === 'true' &&
    kind(canvas) === '"' &&
    kind(reader) === '"' &&
    kind(m.get('sealed')) === '{'
  ) {
    const parts = [
      JSON.stringify({
        schema: RESPONSE_SCHEMA,
        requestId: request.requestId,
        ok: true,
        rendererHash: request.rendererHash,
        runnerId,
      }).slice(0, -1),
      ',"canvas":',
      text(canvas),
      ',"reader":',
      text(reader),
      '}',
    ];
    const length = parts.reduce((n, part) => n + Buffer.byteLength(part), 0);
    if (length > OUTPUT_LIMIT) return { code: 'output_limit' };
    const frame = Buffer.from(new ArrayBuffer(4 + length));
    frame.writeUInt32BE(length);
    let offset = 4;
    for (const part of parts) offset += frame.write(part, offset);
    return { frame };
  }
  // A well-formed historical refusal is still only a worker failure; its
  // message and details never cross the caller interface.
  throw new Error('worker_failed');
}

/** A framed closed refusal. Unknown codes collapse to sandbox_unavailable. */
export function refusalBytes(request, code) {
  const body = Buffer.from(
    JSON.stringify({
      schema: RESPONSE_SCHEMA,
      requestId: request?.requestId ?? null,
      ok: false,
      code: CODES.includes(code) ? code : 'sandbox_unavailable',
    }),
  );
  const framed = Buffer.alloc(4 + body.length);
  framed.writeUInt32BE(body.length);
  body.copy(framed, 4);
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
