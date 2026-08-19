/**
 * Guard: `setInterval` lives in exactly one place under `server/jobs/`.
 *
 * Every scheduled job used to hand-roll the same interval-lifecycle plumbing —
 * `setInterval`, `.unref?.()`, and an idempotent `{ stop() }` (B87). That is now
 * `createIntervalJob` in `server/jobs/interval-job.js`. This gate keeps the
 * duplication from growing back: a new job that reaches for a raw `setInterval`
 * instead of the helper fails here, with the one deliberate exception being the
 * helper itself.
 *
 * `setTimeout` is intentionally NOT gated — digest-email legitimately uses one
 * to align its first run to a wall-clock hour before delegating the recurring
 * interval to the helper.
 *
 * Run with: node --test tests/jobs-interval-lifecycle-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const JOBS_DIR = path.join(repoRoot, 'server', 'jobs');

// The single file allowed to call setInterval: the shared helper.
const HELPER = 'server/jobs/interval-job.js';

const SET_INTERVAL = /\bsetInterval\s*\(/;

/** All .js files under server/jobs/, recursively. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Raw setInterval call-lines in a file (comment-only lines skipped). */
function setIntervalLines(file) {
  const hits = [];
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (SET_INTERVAL.test(line))
        hits.push({ line: i + 1, text: trimmed.trim() });
    });
  return hits;
}

test('setInterval under server/jobs/ appears only in the createIntervalJob helper', () => {
  const violations = [];
  for (const file of walk(JOBS_DIR)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (rel === HELPER) continue;
    for (const h of setIntervalLines(file)) {
      violations.push(`${rel}:${h.line}  ${h.text}`);
    }
  }
  assert.equal(
    violations.length,
    0,
    'Schedule recurring work through createIntervalJob (server/jobs/interval-job.js), ' +
      `not a raw setInterval:\n  ${violations.join('\n  ')}`,
  );
});

test('the createIntervalJob helper still exists and is the one that calls setInterval', () => {
  const helperPath = path.join(repoRoot, HELPER);
  assert.ok(
    fs.existsSync(helperPath),
    `${HELPER} must exist — the gate points at it.`,
  );
  assert.ok(
    setIntervalLines(helperPath).length > 0,
    `${HELPER} is expected to own the sole setInterval call.`,
  );
});
