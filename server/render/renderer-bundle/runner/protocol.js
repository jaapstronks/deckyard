import { isUtf8 } from 'node:buffer';
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
const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);
const ESCAPES = new Set([0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74]);
const HEX = /^[0-9a-fA-F]{4}$/;
const fail = () => {
  throw new Error('invalid_request');
};

/** Strict UTF-8 JSON grammar on the bytes themselves, including duplicate keys
 * at every depth and a byte-order mark. Depth is bounded and no value is
 * decoded: the scan returns byte offsets, and only the members named in `want`
 * (a nested key map) record their own offsets for the caller. The input is
 * never copied, so a 64 MiB guest answer costs no second 64 MiB. */
function scan(bytes, want = null) {
  if (!isUtf8(bytes)) fail();
  const b = bytes;
  let i = 0;
  const whitespace = () => {
    while (WHITESPACE.has(b[i])) i++;
  };
  // Validates one string token in place. Only keys are decoded (for duplicate
  // detection); a value token is never copied, however long it is. Bytes of
  // 0x80 and above are parts of sequences isUtf8 has already validated.
  function string(decode) {
    const start = i++;
    for (;;) {
      if (i >= b.length) fail();
      const c = b[i++];
      if (c === 0x22) break;
      if (c < 0x20) fail();
      if (c === 0x5c) {
        const e = b[i++];
        if (e === 0x75) {
          if (!HEX.test(b.toString('latin1', i, i + 4))) fail();
          i += 4;
        } else if (!ESCAPES.has(e)) fail();
      }
    }
    return decode ? JSON.parse(b.toString('utf8', start, i)) : null;
  }
  // `wanted` is null for an unrecorded value, true for a recorded leaf, or a
  // key map whose members are recorded too. Unrecorded values allocate nothing.
  function value(depth, wanted) {
    if (depth > 64) fail();
    whitespace();
    const start = i,
      c = b[i];
    let keys = 0,
      members = null;
    if (c === 0x22) string(false);
    else if (c === 0x7b || c === 0x5b) {
      const end = c === 0x7b ? 0x7d : 0x5d;
      const seen = new Set();
      if (wanted && wanted !== true) members = new Map();
      i++;
      whitespace();
      if (b[i] === end) i++;
      else
        for (;;) {
          whitespace();
          let inner = null;
          if (c === 0x7b) {
            if (b[i] !== 0x22) fail();
            const key = string(true);
            if (seen.has(key)) fail();
            seen.add(key);
            keys++;
            whitespace();
            if (b[i++] !== 0x3a) fail();
            if (members && Object.hasOwn(wanted, key))
              members.set(key, (inner = value(depth + 1, wanted[key])));
          }
          if (!inner) value(depth + 1, null);
          whitespace();
          if (b[i] === end) {
            i++;
            break;
          }
          if (b[i++] !== 0x2c) fail();
        }
    } else {
      // Literals and numbers are ASCII; JSON.parse checks their grammar.
      while (
        i < b.length &&
        !WHITESPACE.has(b[i]) &&
        b[i] !== 0x2c &&
        b[i] !== 0x5d &&
        b[i] !== 0x7d
      )
        i++;
      if (start === i) fail();
      JSON.parse(b.toString('latin1', start, i));
    }
    return wanted ? { start, end: i, keys, members } : null;
  }
  const root = value(0, want ?? true);
  whitespace();
  if (i !== b.length) fail();
  return root;
}

/** Strict JSON for small lifecycle frames and the bounded guest output. */
export function parseJson(bytes) {
  scan(bytes);
  return JSON.parse(bytes.toString('utf8'));
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
  let root;
  try {
    root = scan(bytes, REQUEST_MEMBERS);
  } catch {
    throw Object.assign(new Error('invalid_request'), { requestId: null });
  }
  const kind = (node) => node && String.fromCharCode(bytes[node.start]);
  const text = (node) => bytes.toString('utf8', node.start, node.end);
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
  // Its own ArrayBuffer: structured clone to the job worker copies exactly the
  // input, never a pooled or larger backing store.
  const owned = Buffer.from(new ArrayBuffer(input.end - input.start));
  bytes.copy(owned, 0, input.start, input.end);
  return {
    schema: 'deckyard.renderer-runner.request/1',
    requestId,
    rendererHash: scalar(members.get('rendererHash')),
    input: owned,
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
  let root;
  try {
    root = scan(bytes, OUTPUT_MEMBERS);
  } catch {
    throw new Error('worker_failed');
  }
  const m = root.members;
  const kind = (node) => node && String.fromCharCode(bytes[node.start]);
  const text = (node) => bytes.toString('utf8', node.start, node.end);
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
    const head = Buffer.from(
      JSON.stringify({
        schema: RESPONSE_SCHEMA,
        requestId: request.requestId,
        ok: true,
        rendererHash: request.rendererHash,
        runnerId,
      }).slice(0, -1),
    );
    const parts = [
      head,
      Buffer.from(',"canvas":'),
      bytes.subarray(canvas.start, canvas.end),
      Buffer.from(',"reader":'),
      bytes.subarray(reader.start, reader.end),
      Buffer.from('}'),
    ];
    const length = parts.reduce((n, part) => n + part.length, 0);
    if (length > OUTPUT_LIMIT) return { code: 'output_limit' };
    const frame = Buffer.from(new ArrayBuffer(4 + length));
    frame.writeUInt32BE(length);
    let offset = 4;
    for (const part of parts) offset += part.copy(frame, offset);
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
