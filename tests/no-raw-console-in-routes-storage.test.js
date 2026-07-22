/**
 * Guard: no bare console.* in server/routes or server/storage.
 *
 * These two trees log through the shared logger (`createLogger` from
 * `server/utils/logger.js`), which gives every line a consistent
 * `[timestamp] [LEVEL] [module]` prefix. Ad-hoc `console.*` bypasses that and
 * re-fragments logging, so it is banned here. Other trees (utils, jobs, db,
 * mcp) still use console directly (CLI / infra output) and are out of scope.
 *
 * If you genuinely need console in a route/storage file, add a `createLogger`
 * instance instead — or, for a deliberate exception, extend ALLOWLIST below
 * with a short reason.
 *
 * Run with: node --test tests/no-raw-console-in-routes-storage.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const TARGET_DIRS = ['server/routes', 'server/storage'];

// { file: 'server/…', reason: '…' } — none needed today.
const ALLOWLIST = [];

const CONSOLE_CALL = /\bconsole\.(log|info|warn|error|debug|trace|dir)\s*\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no bare console.* in server/routes or server/storage', () => {
  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const violations = [];

  for (const dir of TARGET_DIRS) {
    for (const file of walk(path.join(repoRoot, dir))) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      if (allowed.has(rel)) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trimStart();
        // Skip comment-only lines so documentation mentioning console is fine.
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (CONSOLE_CALL.test(line)) {
          violations.push(`${rel}:${i + 1}  ${trimmed.trim()}`);
        }
      });
    }
  }

  assert.equal(
    violations.length,
    0,
    `Use createLogger() instead of console.* in routes/storage:\n  ${violations.join('\n  ')}`
  );
});
