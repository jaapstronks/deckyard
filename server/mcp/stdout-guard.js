/**
 * MCP stdout guard — stdout is protocol.
 *
 * The stdio transport uses stdout *exclusively* for JSON-RPC frames: one stray
 * line makes the client (Claude Desktop, Cursor, …) see invalid JSON and drop
 * the connection. Deckyard modules log status with `console.log` — the slide
 * type registry announces custom types, storage announces its adapter — so
 * every `console.log` in this process has to land on stderr instead.
 *
 * This lives in its own module because ESM evaluates imports before the
 * importing module's body: a redirect written inside `index.js` runs *after*
 * `../storage`, `../../shared` and the custom loaders have already logged.
 * Importing this module first (side-effect import, before every other import
 * in the stdio entrypoint) is what makes the redirect cover import time too.
 *
 * Only the stdio entrypoint imports this. The HTTP/SSE transport
 * (`sse-mount.js`, `sse.js`) shares its process with the web server, where
 * stdout is a normal log stream and must stay one.
 */

import { format } from 'node:util';

const toStderr = (...args) => {
  process.stderr.write(format(...args) + '\n');
};

console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
// console.warn and console.error already write to stderr.
