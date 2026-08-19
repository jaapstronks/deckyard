/**
 * Guard: the live-session domain has one spelling in code — `live-session`.
 *
 * B41-b converged the `present-session` / `live-session` homonym (vocabulary
 * decision D11, brief `vocabulary-homonyms.md`): everything above the
 * persistence boundary says **live-session**. This test pins the loser
 * spellings to zero so they cannot creep back in:
 *
 *   - the hyphen module/route/URL form  `present-session`
 *   - the identifier form                `PresentSession` (Present + Session)
 *   - the only `-db` suffix in storage   `presentation-locks-db`
 *
 * Deliberately NOT forbidden: the snake_case physical table `present_sessions`
 * (and its columns / index names). Renaming the table needs a migration and is
 * out of scope for the behaviour-preserving sweep; the storage layer keeps the
 * physical name while every code-level name is live-session. `server/db/migrations`
 * is excluded as the historical record (migration 060 describes the pre-DB
 * `disk.js` era in its comments and owns the `present_sessions` table itself).
 *
 * Run with: node --test tests/live-session-vocabulary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const TARGET_DIRS = [
  'client',
  'server',
  'shared',
  'scripts',
  'capture',
  'tests',
];
const EXCLUDED_DIRS = new Set([path.join('server', 'db', 'migrations')]);
const SELF = 'live-session-vocabulary.test.js';

// Needles built from fragments so this guard file does not match its own text.
const FORBIDDEN = [
  {
    label: 'present' + '-session (use live-session)',
    re: new RegExp('present' + '-session'),
  },
  {
    label: 'Present' + 'Session identifier (use LiveSession)',
    re: new RegExp('Present' + 'Session'),
  },
  {
    label: 'presentation-locks' + '-db (drop the -db suffix)',
    re: new RegExp('presentation-locks' + '-db'),
  },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(repoRoot, full);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(rel)) continue;
      walk(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.js') &&
      entry.name !== SELF
    ) {
      out.push(full);
    }
  }
  return out;
}

test('live-session vocabulary: no present-session spellings survive in code', () => {
  const violations = [];
  for (const dir of TARGET_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(repoRoot, file).split(path.sep).join('/');
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const { label, re } of FORBIDDEN) {
          if (re.test(line))
            violations.push(`${rel}:${i + 1}  [${label}]  ${line.trim()}`);
        }
      });
    }
  }
  assert.equal(
    violations.length,
    0,
    `Use the live-session spelling (physical table present_sessions excepted):\n  ${violations.join('\n  ')}`,
  );
});
