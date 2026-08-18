/**
 * Guard: the real-time SSE services own no bespoke client registry.
 *
 * `server/services/*-events.js` (notifications, comments) each used to
 * hand-roll the same `Map<key, Set<res>>` registry and the same global
 * heartbeat `setInterval` (B87). Both now go through `createSseHub`
 * (`server/utils/sse.js`). This gate is the tripwire that keeps a new event
 * service — or a regression in these two — from reintroducing the duplication:
 * a `*-events.js` file that declares its own `new Map()` registry or its own
 * `setInterval` heartbeat fails here and must use the factory instead.
 *
 * Deliberately narrow: it targets the `*-events.js` SSE services only. The
 * per-presentation follow status ticker
 * (`server/routes/api/follow/status-ticker.js`) is a different abstraction —
 * a shared-compute fan-out with a per-group timer coupled to subscriber count,
 * not a res-broadcast hub — and is not in scope here.
 *
 * Run with: node --test tests/sse-hub-single-registry.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const SERVICES_DIR = path.join(repoRoot, 'server', 'services');

const SET_INTERVAL = /\bsetInterval\s*\(/;
const NEW_MAP = /\bnew\s+Map\s*\(/;

/** *-events.js files under server/services/. */
function eventServiceFiles() {
  return fs
    .readdirSync(SERVICES_DIR)
    .filter((name) => name.endsWith('-events.js'))
    .map((name) => path.join(SERVICES_DIR, name));
}

/** Non-comment lines matching a pattern. */
function offendingLines(file, pattern) {
  const hits = [];
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (pattern.test(line)) hits.push(`${i + 1}  ${trimmed.trim()}`);
    });
  return hits;
}

test('SSE *-events services declare no bespoke registry or heartbeat (use createSseHub)', () => {
  const files = eventServiceFiles();
  assert.ok(files.length >= 2, 'expected the notification and comment event services to exist');

  const violations = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    for (const hit of offendingLines(file, SET_INTERVAL)) {
      violations.push(`${rel}:${hit}  — heartbeat belongs to createSseHub`);
    }
    for (const hit of offendingLines(file, NEW_MAP)) {
      violations.push(`${rel}:${hit}  — client registry belongs to createSseHub`);
    }
  }

  assert.equal(
    violations.length,
    0,
    'Route SSE client tracking through createSseHub (server/utils/sse.js) ' +
      `instead of a bespoke registry/heartbeat:\n  ${violations.join('\n  ')}`
  );
});
