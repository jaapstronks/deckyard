/**
 * Guard: an e-mail address is folded in one place, `normalizeEmail` in
 * shared/email.js (D200, B664).
 *
 * Writes fold through that function and reads compare the stored value bare.
 * A second fold — a private `normalizeEmail`, an inline `.toLowerCase()` on an
 * address, SQL `lower()` on an e-mail column — means some write path stored a
 * spelling the rest of the code does not expect, and the read was patched
 * instead of the write. Four such normalisers and some 35 inline folds had
 * grown before this guard; the history is in migration 092.
 *
 * Measured over `server/`, `shared/` and `client/` (vendor excluded): the
 * browser compares the addresses the server hands it bare and folds only what
 * a user types, through the same function (B699). Migrations are excluded:
 * they are history, and the old backfills join on `lower()` deliberately.
 *
 * Run with: node --test tests/email-fold-sites.test.js
 */

import { walkFiles } from './helpers/walk-files.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeEmail } from '../shared/email.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const CANONICAL = 'shared/email.js';
const MIGRATIONS = 'server/db/migrations/';

const sources = ['server', 'shared', 'client']
  .flatMap((tree) =>
    walkFiles(path.join(repoRoot, tree), {
      extensions: ['.js'],
      skipDirs: ['vendor', 'node_modules'],
    }),
  )
  .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
  .filter((rel) => rel !== CANONICAL && !rel.startsWith(MIGRATIONS))
  .map((rel) => ({
    rel,
    src: fs.readFileSync(path.join(repoRoot, rel), 'utf8'),
  }));

/** `rel:line` for a match offset. */
const at = (rel, src, index) =>
  `${rel}:${src.slice(0, index).split('\n').length}`;

/**
 * Whether an identifier names an address. `email_verified` is an OIDC claim
 * holding a boolean, not an address.
 */
const ADDRESS = /[eE]mail(?!_verified)/;

test('normalizeEmail is defined only in shared/email.js', () => {
  const definition = /\bfunction\s+normalizeEmail\b|\bnormalizeEmail\s*=/;
  const offenders = sources
    .filter(({ src }) => definition.test(src))
    .map(({ rel }) => rel);
  assert.deepEqual(offenders, []);
});

test('no inline toLowerCase() on an e-mail address', () => {
  const offenders = [];
  for (const { rel, src } of sources) {
    for (const m of src.matchAll(/\.toLowerCase\(/g)) {
      // The expression being folded: everything back to the start of the
      // statement or argument it sits in.
      const before = src.slice(Math.max(0, m.index - 160), m.index);
      const expr = before.split(/[;{}(,=?:]\s*\n|[;{}]|\n\s*\n/).pop();
      if (ADDRESS.test(expr)) offenders.push(at(rel, src, m.index));
    }
  }
  assert.deepEqual(offenders, []);
});

test('no SQL lower() on an e-mail column', () => {
  const lowerOnEmail = /lower\(\s*(?:btrim\(\s*)?[\w."$`{}]*(?:email|_by\b)/gi;
  const offenders = [];
  for (const { rel, src } of sources) {
    for (const m of src.matchAll(lowerOnEmail))
      offenders.push(at(rel, src, m.index));
  }
  assert.deepEqual(offenders, []);
});

test('normalizeEmail trims, lower-cases and maps blank to null', () => {
  assert.equal(normalizeEmail('  Ann@Example.COM '), 'ann@example.com');
  assert.equal(normalizeEmail('ann@example.com'), 'ann@example.com');
  assert.equal(normalizeEmail('   '), null);
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(undefined), null);
});
