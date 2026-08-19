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
 * 1. ALLOWLIST — files whose raw console output is the point: the logger
 *    implementation itself, the migrate CLI, and the boot banners in
 *    server.js. An entry may pin `count`: the exemption then covers exactly
 *    that many call sites, so a new raw console in an allowlisted file still
 *    fails here instead of riding along on the exemption.
 * 2. CLI tails — `if (process.argv[1]?.endsWith('…')) {` blocks in jobs
 *    files: output for a human running the file directly. The scanner
 *    skips those blocks (brace-balanced from the guard line); the guard
 *    must carry its opening brace on the same line to be recognized.
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
  {
    file: 'server/utils/logger.js',
    reason: 'the logger implementation itself',
  },
  {
    file: 'server/utils/debug-log.js',
    reason: 'logger family: DEBUG_LOG-gated raw output is the contract',
  },
  {
    file: 'server/db/migrate.js',
    reason: 'CLI output for a human running migrations',
  },
  {
    file: 'server/server.js',
    reason:
      'boot banners (pre/at-listen fatals and warnings) go to stdout unadorned; shutdown logs through createLogger',
    count: 8,
  },
];

// Every console method that produces output, plus the computed-member form
// (`console[level](…)`) that would otherwise slip past a method-name list.
const CONSOLE_CALL =
  /\bconsole\s*(?:\.\s*(?:log|info|warn|error|debug|trace|dir|table|group|groupCollapsed|groupEnd|count|countReset|time|timeEnd|timeLog|assert)\s*\(|\[)/;

// A CLI tail is only recognized in its canonical shape: the `?.endsWith(`
// guard with its opening brace on the same line. A braceless or differently
// shaped guard is NOT masked — the brace-balancing below would otherwise run
// past the guard and mask unrelated code.
const CLI_TAIL_GUARD =
  /if\s*\(\s*process\.argv\[1\]\?\.endsWith\(.*\)\s*\{\s*$/;

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

/** Raw console call-lines in a file (comment-only lines skipped). */
function consoleCallLines(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const inTail = cliTailMask(lines);
  const hits = [];
  lines.forEach((line, i) => {
    if (inTail[i]) return;
    const trimmed = line.trimStart();
    // Skip comment-only lines so documentation mentioning console is fine.
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (CONSOLE_CALL.test(line))
      hits.push({ line: i + 1, text: trimmed.trim() });
  });
  return hits;
}

test('no bare console.* under server/ (log through createLogger)', () => {
  const allowed = new Map(ALLOWLIST.map((a) => [a.file, a]));
  const violations = [];

  for (const file of walk(path.join(repoRoot, 'server'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const entry = allowed.get(rel);
    if (entry && entry.count === undefined) continue;
    const hits = consoleCallLines(file);
    if (entry) {
      // Count-pinned exemption: the file may keep exactly `count` raw sites.
      if (hits.length !== entry.count) {
        violations.push(
          `${rel}: ${hits.length} raw console sites, allowlist pins ${entry.count} — ` +
            'use createLogger() for new logging, or re-pin with a reason',
        );
      }
      continue;
    }
    for (const h of hits) violations.push(`${rel}:${h.line}  ${h.text}`);
  }

  assert.equal(
    violations.length,
    0,
    `Use createLogger() instead of console.* in server code:\n  ${violations.join('\n  ')}`,
  );
});

test('the allowlist only names files that still exist', () => {
  for (const { file } of ALLOWLIST) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, file)),
      `Stale allowlist entry: ${file} no longer exists — remove it.`,
    );
  }
});

test('createLogger namespaces are kebab-case', () => {
  // One vocabulary for the [module] slot: lowercase kebab-case, so grepping a
  // log line back to its module never stumbles over spelling ('DB' vs 'db',
  // 'AI Log' vs 'ai-log', a bare migration number).
  const NAMESPACE = /createLogger\(\s*'([^']*)'\s*\)/g;
  const OK = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const bad = [];
  for (const file of walk(path.join(repoRoot, 'server'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(NAMESPACE)) {
      if (!OK.test(m[1])) {
        const line = src.slice(0, m.index).split('\n').length;
        bad.push(`${rel}:${line}  createLogger('${m[1]}')`);
      }
    }
  }
  assert.equal(
    bad.length,
    0,
    `Logger namespaces must be kebab-case:\n  ${bad.join('\n  ')}`,
  );
});
