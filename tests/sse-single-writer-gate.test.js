/**
 * B105 gate — `sseWrite()` is the only thing that writes an SSE frame.
 *
 * Four private writer closures used to live next to `openSseStream` imports
 * (convert, notion import, wizard-v2 stream, MCP GET) plus five inline
 * `res.write(\`event: …\`)` calls. All of them wrote the `event:` and `data:`
 * lines as two separate `write()` calls or without the
 * `writable`/`writableEnded` guard — two documented ways to be worse than the
 * helper: interleaved frames when broadcasts overlap, and
 * `ERR_STREAM_WRITE_AFTER_END` when a client disconnects mid-stream.
 *
 * This pins the single-writer shape: nothing under `server/` may build an SSE
 * frame in a `write()` argument except `server/utils/sse.js` itself, which
 * owns `sseWrite` (frames), `sseComment` (heartbeats) and the client hub's
 * fan-out. The allowlist is deliberately empty — a new entry means a second
 * writer came back.
 *
 * Run with: node --test tests/sse-single-writer-gate.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** Recursively collect .js files under a directory. */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Files allowed to hand-write an SSE frame. Keep this empty. */
const ALLOWLIST = new Set(['server/utils/sse.js']);

/** A `write(` whose argument text contains an SSE field name. */
const FRAME_WRITE = /\.write\(\s*[^)]{0,400}?(?:\\n|\n)?(?:event|data):/;

test('no hand-rolled SSE frame writer outside server/utils/sse.js', () => {
  const offenders = [];
  for (const file of jsFiles(path.join(repoRoot, 'server'))) {
    const rel = path.relative(repoRoot, file);
    if (ALLOWLIST.has(rel)) continue;
    // Multi-line `res.write(\n  \`event: …\`,\n)` is folded to one line
    // first so the regex sees the argument next to the call.
    const src = readFileSync(file, 'utf8').replace(/\n\s*/g, ' ');
    if (FRAME_WRITE.test(src)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `SSE frames are written by sseWrite() only — these build one by hand:\n  ${offenders.join('\n  ')}`,
  );
});

test('sseWrite is the exported frame writer and formatSSEMessage is private', async () => {
  const mod = await import('../server/utils/sse.js');
  assert.equal(typeof mod.sseWrite, 'function');
  assert.equal(
    mod.formatSSEMessage,
    undefined,
    'formatSSEMessage is module-private: a public frame builder invites a second writer',
  );
});

// --- what the hand-rolled writers got wrong ---------------------------------

function fakeRes() {
  return {
    writable: true,
    writableEnded: false,
    writes: [],
    write(chunk) {
      if (this.writableEnded) throw new Error('ERR_STREAM_WRITE_AFTER_END');
      this.writes.push(String(chunk));
      return true;
    },
  };
}

test('sseWrite emits one atomic frame, never event and data separately', async () => {
  const { sseWrite } = await import('../server/utils/sse.js');
  const res = fakeRes();
  sseWrite(res, { event: 'status', data: { progress: 5 } });
  assert.equal(
    res.writes.length,
    1,
    'one write() call, so frames cannot interleave',
  );
  assert.equal(res.writes[0], 'event: status\ndata: {"progress":5}\n\n');
});

test('sseWrite is a no-op after the client disconnected', async () => {
  const { sseWrite } = await import('../server/utils/sse.js');
  const res = fakeRes();
  res.writableEnded = true;
  res.writable = false;
  assert.doesNotThrow(() =>
    sseWrite(res, { event: 'status', data: { progress: 50 } }),
  );
  assert.deepEqual(res.writes, [], 'nothing written after the stream ended');
});
