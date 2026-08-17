/**
 * Guard: the ambiguous `formatNumber` name stays retired, and each number
 * formatter has exactly one definition (A7.21 PR C, decision D30).
 *
 * `formatNumber` was one name for three different behaviours — thousands
 * separators (analytics), a K/M compact suffix (dashboard cards), and
 * locale-aware fixed decimals (KPI runtime). D30 split it into three distinct
 * names, so the single ambiguous name must never come back, and none of the
 * three replacements may be redefined elsewhere.
 *
 * One name for three outputs is the core of this drift (CLAUDE.md § beta
 * doctrine); this gate fails if `formatNumber` reappears or a replacement is
 * duplicated. Client-scoped: the number formatters live in the client tree.
 *
 * Run with: node --test tests/no-formatnumber-alias.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const SKIP_DIRS = new Set(['vendor', 'node_modules']);

// The three names that replaced `formatNumber` → their one canonical module.
const OWNED = {
  formatCount: 'client/lib/format/analytics-format.js',
  formatCompact: 'client/lib/format/analytics-format.js',
  formatDecimal: 'client/lib/slide-runtime/kpi-metrics-runtime.js',
};

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

test('the ambiguous formatNumber name stays retired', () => {
  const violations = [];
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    if (/\bformatNumber\b/.test(src)) {
      violations.push(`${rel}: uses 'formatNumber' — split into formatCount / formatCompact / formatDecimal`);
    }
  }
  assert.equal(violations.length, 0, `formatNumber reintroduced:\n  ${violations.join('\n  ')}`);
});

test('each number formatter has one definition, in its canonical module', () => {
  const violations = [];
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const [name, owner] of Object.entries(OWNED)) {
      if (rel !== owner && definesName(src, name)) {
        violations.push(`${rel}: redefines '${name}' — the only definition lives in ${owner}`);
      }
      if (new RegExp(`\\bas\\s+${name}\\b`).test(src)) {
        violations.push(`${rel}: aliases something 'as ${name}' — that name has one canonical definition`);
      }
    }
  }
  for (const [name, owner] of Object.entries(OWNED)) {
    const src = fs.readFileSync(path.join(repoRoot, owner), 'utf8');
    assert.ok(definesName(src, name), `${owner} must define ${name}`);
  }
  assert.equal(violations.length, 0, `number formatter drift:\n  ${violations.join('\n  ')}`);
});
