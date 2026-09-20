/**
 * Guards over `.env.example`: it is the complete manifest of recognized
 * environment variables, and every declaration line carries a value and
 * nothing else.
 *
 * Every env var the engine reads — as a literal `process.env.SOME_VAR` or
 * through the accessor family (`envStr('SOME_VAR')` and friends) — must have
 * a declaration line in `.env.example` (`VAR=` or `# VAR=`), so the knobs a
 * self-hoster can turn — including the security limits — are discoverable in
 * one place. Adding a new env read without documenting it fails here.
 *
 * The manifest may only grow: renaming or removing a declared variable is a
 * breaking change per docs/reference/versioning.md.
 *
 * The second guard is about the shape of those lines. `loadDotEnv()` takes
 * everything after the first `=` as the value — no inline-comment syntax,
 * deliberately, because stripping a `#` would silently truncate a secret that
 * contains one. So a declaration line may not carry a trailing note: comments
 * go on their own line above the declaration.
 *
 * The walk covers every tree that runs on a server: `server/` and the
 * server-side half of `shared/`. A knob is public surface wherever it is read
 * from, so scoping this to one directory would let the next one in through
 * whichever tree the gate does not walk.
 *
 * Run with: node --test tests/env-manifest.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

// Not configuration: set by the runtime/test-runner, never by an operator.
const EXEMPT = new Set(['NODE_ENV', 'NODE_TEST_CONTEXT']);

// The trees whose env reads are operator-facing configuration.
const SOURCE_TREES = ['server', 'shared'];

// A literal read, or a read through the accessor family / the named-env
// helpers — both count: the accessor form is the canonical one, so the gate
// must not go blind exactly where the codebase follows the convention.
const ENV_READS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /\b(?:envStr|envBool|envInt|envList|requireEnv|optionalEnv|createConfigChecker)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
];
const DECLARATION = /^#? ?([A-Z][A-Z0-9_]+)=/;

// A note tacked onto the value: ` # …` (a would-be inline comment) or ` (…`
// (a parenthetical aside). Both end up inside the value at load time.
const TRAILING_NOTE = /\s#|\s\(/;

function* envReads(src) {
  for (const re of ENV_READS) {
    for (const m of src.matchAll(re)) yield m;
  }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function declaredVars() {
  const declared = new Set();
  const lines = fs
    .readFileSync(path.join(repoRoot, '.env.example'), 'utf8')
    .split('\n');
  for (const line of lines) {
    const m = line.match(DECLARATION);
    if (m) declared.add(m[1]);
  }
  return declared;
}

test('no declaration line in .env.example carries a trailing note', () => {
  const lines = fs
    .readFileSync(path.join(repoRoot, '.env.example'), 'utf8')
    .split('\n');

  const offenders = [];
  lines.forEach((line, i) => {
    // Strip one leading `# ` so commented-out declarations are checked too —
    // they are the ones an operator uncomments, note and all.
    const bare = line.replace(/^#\s?/, '');
    const m = bare.match(/^([A-Z][A-Z0-9_]+)=(.*)$/);
    if (!m) return;
    if (TRAILING_NOTE.test(m[2])) offenders.push(`${i + 1}: ${line}`);
  });

  assert.equal(
    offenders.length,
    0,
    'Declaration lines in .env.example with a trailing note — everything ' +
      'after `=` is the value, so put the comment on its own line above:\n  ' +
      offenders.join('\n  '),
  );
});

test('every env var the engine reads is declared in .env.example', () => {
  const declared = declaredVars();
  const undeclared = new Map(); // var -> first read site

  for (const file of SOURCE_TREES.flatMap((tree) =>
    walk(path.join(repoRoot, tree)),
  )) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const m of envReads(src)) {
      const name = m[1];
      if (EXEMPT.has(name) || declared.has(name)) continue;
      if (!undeclared.has(name)) {
        const line = src.slice(0, m.index).split('\n').length;
        undeclared.set(name, `${rel}:${line}`);
      }
    }
  }

  const report = [...undeclared.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, site]) => `${name}  (first read: ${site})`);
  assert.equal(
    report.length,
    0,
    `Env vars read by engine code but missing from .env.example:\n  ${report.join('\n  ')}`,
  );
});

test('the exempt list only names vars the engine actually reads', () => {
  const read = new Set();
  for (const file of SOURCE_TREES.flatMap((tree) =>
    walk(path.join(repoRoot, tree)),
  )) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of envReads(src)) read.add(m[1]);
  }
  for (const name of EXEMPT) {
    assert.ok(
      read.has(name),
      `Stale exempt entry: ${name} is no longer read by server code — remove it.`,
    );
  }
});
