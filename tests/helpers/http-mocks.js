import { EventEmitter } from 'node:events';

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
    ended: false,
    setHeader(name, value) {
      const key = Object.keys(this.headers).find(
        (key) => key.toLowerCase() === name.toLowerCase(),
      );
      this.headers[key ?? name] = value;
    },
    getHeader(name) {
      const key = Object.keys(this.headers).find(
        (key) => key.toLowerCase() === name.toLowerCase(),
      );
      return this.headers[key];
    },
    appendHeader(name, value) {
      const previous = this.getHeader(name);
      this.setHeader(
        name,
        previous === undefined ? value : [previous, value].flat(),
      );
    },
    writeHead(status, headers) {
      this.statusCode = status;
      Object.assign(this.headers, headers);
      return this;
    },
    end(body) {
      this.body = body ?? null;
      this.ended = true;
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

/** Track committed headers and completion for handlers that refuse a second response. */
export function createMockLifecycleRes() {
  const res = createMockRes();
  const { writeHead, end } = res;
  return Object.assign(res, {
    headersSent: false,
    writableEnded: false,
    writeHead(...args) {
      writeHead.apply(this, args);
      this.headersSent = true;
      return this;
    },
    end(...args) {
      end.apply(this, args);
      this.headersSent = true;
      this.writableEnded = true;
      return this;
    },
  });
}

/** Capture ordered raw stream bytes; parse JSON only when the caller asks. */
export function createMockStreamRes() {
  const res = createMockLifecycleRes();
  const chunks = [];
  Object.defineProperty(res, 'body', {
    get() {
      return Buffer.concat(chunks);
    },
  });
  return Object.assign(res, {
    chunks,
    json() {
      return this.body.length ? JSON.parse(this.body.toString('utf8')) : null;
    },
    write(chunk) {
      if (this.statusCode === null) this.statusCode = 200;
      this.headersSent = true;
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk != null) this.write(chunk);
      if (this.statusCode === null) this.statusCode = 200;
      this.headersSent = true;
      this.ended = true;
      this.writableEnded = true;
      return this;
    },
  });
}

/** Event-capable raw SSE transport; rejects writes after end, without parsing frames. */
export function createMockEventStreamRes() {
  const res = Object.defineProperties(
    new EventEmitter(),
    Object.getOwnPropertyDescriptors(createMockStreamRes()),
  );
  res.writable = true;
  res.writableFinished = false;
  res.flushed = false;
  const { write, end } = res;
  res.flushHeaders = function () {
    this.headersSent = true;
    this.flushed = true;
  };
  res.write = function (chunk) {
    if (this.writableEnded) throw new Error('ERR_STREAM_WRITE_AFTER_END');
    return write.call(this, chunk);
  };
  res.end = function (chunk) {
    end.call(this, chunk);
    this.writable = false;
    this.writableFinished = true;
    return this;
  };
  return res;
}
