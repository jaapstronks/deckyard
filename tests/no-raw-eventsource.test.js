/**
 * Guard: one canonical client SSE helper (B75, decision D33).
 *
 * `new EventSource(...)` may appear only inside `createSSEConnection`
 * (client/lib/net/sse-connection.js). Every consumer goes through that helper,
 * so reconnect/teardown lives in exactly one place — the class of bug this
 * kills is a reopen timer that outlives the view that owns it.
 *
 * The single allowlisted exception is documented below. A new bare
 * `new EventSource` anywhere else in client/ is tolerance-creep (CLAUDE.md
 * § beta doctrine) and fails this test.
 *
 * Run with: node --test tests/no-raw-eventsource.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const SKIP_DIRS = new Set(['vendor', 'node_modules']);

// The one module allowed to construct an EventSource.
const CANONICAL_FILE = 'client/lib/net/sse-connection.js';

// Deliberate exceptions, each with a reason. These are NOT reconnecting
// streams, so wrapping them in the reconnect helper would be semantically
// wrong.
const ALLOWLIST = new Map([
  [
    'client/views/settings/tabs/export-tab.js',
    'supplemental one-shot listener for export_ready; deliberately does not ' +
      'reconnect (the notification bell owns the resilient notifications stream).',
  ],
]);

const RAW_EVENTSOURCE = /new\s+EventSource\s*\(/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const clientFiles = walk(path.join(repoRoot, 'client'));

test('new EventSource only appears in the canonical helper (+ allowlist)', () => {
  const violations = [];
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (rel === CANONICAL_FILE || ALLOWLIST.has(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (RAW_EVENTSOURCE.test(src)) {
      violations.push(`${rel}: constructs EventSource directly — use createSSEConnection`);
    }
  }
  assert.equal(
    violations.length,
    0,
    `raw EventSource outside the helper:\n  ${violations.join('\n  ')}`
  );
});

test('the canonical helper still owns an EventSource', () => {
  const src = fs.readFileSync(path.join(repoRoot, CANONICAL_FILE), 'utf8');
  assert.match(src, RAW_EVENTSOURCE, `${CANONICAL_FILE} should construct the EventSource`);
});

test('every allowlisted file still exists and still constructs one', () => {
  for (const [rel] of ALLOWLIST) {
    const abs = path.join(repoRoot, rel);
    assert.ok(fs.existsSync(abs), `allowlisted ${rel} no longer exists — update this guard.`);
    const src = fs.readFileSync(abs, 'utf8');
    assert.match(
      src,
      RAW_EVENTSOURCE,
      `allowlisted ${rel} no longer constructs an EventSource — drop it from the allowlist.`
    );
  }
});
