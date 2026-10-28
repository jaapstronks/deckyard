import { parseJson } from '../protocol.js';

/** Bounded, sequenced lifecycle channel. The socket is already authenticated.
 * No JSON body or path from a render caller enters this channel. */
export function lifecycleChannel(socket, onMessage, onFailure) {
  let buffer = Buffer.alloc(0),
    incoming = 0,
    outgoing = 0,
    closed = false;
  function fail() {
    if (closed) return;
    closed = true;
    socket.destroy();
    onFailure();
  }
  socket.on('error', fail);
  socket.on('close', fail);
  socket.on('data', (chunk) => {
    if (closed) return;
    if (buffer.length + chunk.length > 8192) {
      fail();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    try {
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE();
        if (!size || size > 4096) throw new Error('invalid lifecycle frame');
        if (buffer.length < size + 4) break;
        const message = parseJson(buffer.subarray(4, size + 4));
        buffer = buffer.subarray(size + 4);
        if (message.seq !== incoming++ || typeof message.op !== 'string')
          throw new Error('invalid lifecycle sequence');
        onMessage(message);
      }
    } catch {
      fail();
    }
  });
  socket.resume();
  return {
    send(message) {
      if (closed) throw new Error('lifecycle closed');
      const body = Buffer.from(JSON.stringify({ ...message, seq: outgoing++ }));
      if (body.length > 4096 || socket.writableLength > 8192) {
        fail();
        throw new Error('lifecycle overflow');
      }
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      socket.write(Buffer.concat([header, body]));
    },
    close: fail,
  };
}
