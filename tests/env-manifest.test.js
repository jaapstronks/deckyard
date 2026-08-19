/**
 * Guard: `.env.example` is the complete manifest of recognized environment
 * variables.
 *
 * Every env var the server reads — as a literal `process.env.SOME_VAR` or
 * through the accessor family (`envStr('SOME_VAR')` and friends) — must have
 * a declaration line in `.env.example` (`VAR=` or `# VAR=`), so the knobs a
 * self-hoster can turn — including the security limits — are discoverable in
 * one place. Adding a new env read without documenting it fails here.
 *
 * The manifest may only grow: renaming or removing a declared variable is a
 * breaking change per docs/reference/versioning.md.
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

// A literal read, or a read through the accessor family / the named-env
// helpers — both count: the accessor form is the canonical one, so the gate
// must not go blind exactly where the codebase follows the convention.
const ENV_READS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /\b(?:envStr|envBool|envInt|envList|requireEnv|optionalEnv|createConfigChecker)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g,
];
const DECLARATION = /^#? ?([A-Z][A-Z0-9_]+)=/;

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

test('every env var the server reads is declared in .env.example', () => {
  const declared = declaredVars();
  const undeclared = new Map(); // var -> first read site

  for (const file of walk(path.join(repoRoot, 'server'))) {
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
    `Env vars read by server code but missing from .env.example:\n  ${report.join('\n  ')}`,
  );
});

test('the exempt list only names vars the server actually reads', () => {
  const read = new Set();
  for (const file of walk(path.join(repoRoot, 'server'))) {
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
