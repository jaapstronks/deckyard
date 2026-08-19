/**
 * Guard: one canonical name and one definition per time/date/duration
 * formatter in the client format family (A7.21 PR B, decision D30).
 *
 * The client `lib/format/` family had drifted into two spellings and several
 * same-named local redefinitions:
 *   - `fmtRelativeTime` (user-format.js) alongside `formatRelativeTime`;
 *   - `fmtDate` (format.js, my-data.js) alongside the `format*` prefix;
 *   - local `formatDate` / `formatDuration` copies in analytics views.
 *
 * Each formatter now has exactly one definition in one canonical module; the
 * `fmt*` spelling is retired. A second accepted spelling or a same-named local
 * copy is tolerance-creep (CLAUDE.md § beta doctrine), so this gate fails if
 * one is reintroduced.
 *
 * Scope is the client tree only: the server and shared trees carry their own,
 * unrelated `formatDuration` (server/storage/analytics/weekly-summary.js,
 * shared/slide-timing.js) — a different concept boundary, out of this family.
 *
 * Run with: node --test tests/no-time-formatter-aliases.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const SKIP_DIRS = new Set(['vendor', 'node_modules']);

// Canonical time/date/duration formatters → the one module allowed to define each.
const OWNED = {
  formatRelativeTime: 'client/lib/format/format-time.js',
  formatDate: 'client/lib/format/analytics-format.js',
  formatDuration: 'client/lib/format/analytics-format.js',
  formatDateTime: 'client/lib/format/format.js',
  formatTimeShort: 'client/lib/format/analytics-format.js',
};

// Retired `fmt*` spellings that must not reappear as an identifier anywhere.
const RETIRED = ['fmtDate', 'fmtRelativeTime'];

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

/** A `function NAME` or `const/let/var NAME =` declaration of NAME. */
function definesName(src, name) {
  const fn = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`);
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`);
  return fn.test(src) || decl.test(src);
}

test('each time/date/duration formatter has one definition, in its canonical module', () => {
  const violations = [];
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const [name, owner] of Object.entries(OWNED)) {
      if (rel !== owner && definesName(src, name)) {
        violations.push(
          `${rel}: redefines '${name}' — the only definition lives in ${owner}`,
        );
      }
      if (new RegExp(`\\bas\\s+${name}\\b`).test(src)) {
        violations.push(
          `${rel}: aliases something 'as ${name}' — that name has one canonical definition`,
        );
      }
    }
  }
  // Sanity: each canonical module still defines the name it owns, so a future
  // rename of the canonical forces this guard to be updated in step.
  for (const [name, owner] of Object.entries(OWNED)) {
    const src = fs.readFileSync(path.join(repoRoot, owner), 'utf8');
    assert.ok(definesName(src, name), `${owner} must define ${name}`);
  }
  assert.equal(
    violations.length,
    0,
    `time/date/duration formatter drift:\n  ${violations.join('\n  ')}`,
  );
});

test('the retired fmt* formatter spellings stay gone', () => {
  const violations = [];
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const name of RETIRED) {
      if (new RegExp(`\\b${name}\\b`).test(src)) {
        violations.push(
          `${rel}: uses retired '${name}' — the format* spelling is canonical`,
        );
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `retired fmt* spelling reintroduced:\n  ${violations.join('\n  ')}`,
  );
});
