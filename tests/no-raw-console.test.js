/**
 * Guard: no bare console.* anywhere under server/.
 *
 * Server code logs through the shared logger (`createLogger` from
 * `server/utils/logger.js`), which gives every line a consistent
 * `[timestamp] [LEVEL] [module]` prefix, gates debug output on DEBUG_LOG,
 * and is the single seam where redaction or a transport can ever land.
 * Ad-hoc `console.*` bypasses all of that and re-fragments logging.
 *
 * Two kinds of exceptions exist, both deliberate:
 *
 * 1. ALLOWLIST — whole files whose raw console output is the point:
 *    the logger implementation itself, the migrate CLI, and the
 *    boot/shutdown lines in server.js that must reach stdout unadorned.
 * 2. CLI tails — `if (process.argv[1]?.endsWith(...))` blocks in jobs
 *    files: output for a human running the file directly. The scanner
 *    skips those blocks (brace-balanced from the guard line).
 *
 * Anything else: use `createLogger()` — or extend ALLOWLIST with a reason.
 *
 * Run with: node --test tests/no-raw-console.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const ALLOWLIST = [
  { file: 'server/utils/logger.js', reason: 'the logger implementation itself' },
  { file: 'server/utils/debug-log.js', reason: 'logger family: DEBUG_LOG-gated raw output is the contract' },
  { file: 'server/db/migrate.js', reason: 'CLI output for a human running migrations' },
  { file: 'server/server.js', reason: 'boot/shutdown lines run before/after everything and go to stdout unadorned' },
];

const CONSOLE_CALL = /\bconsole\.(log|info|warn|error|debug|trace|dir)\s*\(/;
const CLI_TAIL_GUARD = /if\s*\(\s*process\.argv\[1\]/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Mark the lines belonging to CLI-tail blocks: from a line matching
 * CLI_TAIL_GUARD until its braces balance out again.
 * @param {string[]} lines
 * @returns {boolean[]} true = line is inside a CLI tail
 */
function cliTailMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let depth = 0;
  let inTail = false;
  lines.forEach((line, i) => {
    if (!inTail && CLI_TAIL_GUARD.test(line)) {
      inTail = true;
      depth = 0;
    }
    if (inTail) {
      mask[i] = true;
      for (const ch of line) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
      }
      if (depth <= 0 && line.includes('}')) inTail = false;
    }
  });
  return mask;
}

test('no bare console.* under server/ (log through createLogger)', () => {
  const allowed = new Set(ALLOWLIST.map((a) => a.file));
  const violations = [];

  for (const file of walk(path.join(repoRoot, 'server'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (allowed.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const inTail = cliTailMask(lines);
    lines.forEach((line, i) => {
      if (inTail[i]) return;
      const trimmed = line.trimStart();
      // Skip comment-only lines so documentation mentioning console is fine.
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (CONSOLE_CALL.test(line)) {
        violations.push(`${rel}:${i + 1}  ${trimmed.trim()}`);
      }
    });
  }

  assert.equal(
    violations.length,
    0,
    `Use createLogger() instead of console.* in server code:\n  ${violations.join('\n  ')}`
  );
});

test('the allowlist only names files that still exist', () => {
  for (const { file } of ALLOWLIST) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, file)),
      `Stale allowlist entry: ${file} no longer exists — remove it.`
    );
  }
});
