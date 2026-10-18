/** Small HTTP doubles for handler tests; bodies stay raw until json() is read. */

/** Create a JSON-body request with an async iterable, like IncomingMessage. */
export function createMockReq({
  method = 'GET',
  headers = {},
  body = null,
} = {}) {
  const bytes = Buffer.from(body == null ? '' : JSON.stringify(body), 'utf8');
  return {
    method,
    headers,
    socket: {},
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

/** Capture the status, headers and raw body written by an HTTP handler. */
export function createMockRes() {
  return {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      return this;
    },
    end(body) {
      this.body = body ?? null;
      return this;
    },
    json() {
      return this.body ? JSON.parse(String(this.body)) : null;
    },
  };
}

/**
 * An open SSE stream that records the frames `sseWrite()` gives it, parsed
 * as `{ event, data }`.
 */
export function createMockSseRes() {
  const frames = [];
  return {
    frames,
    writable: true,
    writableEnded: false,
    write(chunk) {
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (event) frames.push({ event, data: data && JSON.parse(data) });
      return true;
    },
  };
}
