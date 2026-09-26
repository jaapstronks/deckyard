/**
 * The counters planning notes cite are derived, not copied.
 *
 * scripts/count-codebase.js exists because every hand-counted number in the
 * private worklist drifted between two audits while every number a test
 * carried stayed right. A derivation only helps while it still sees the
 * codebase: a moved directory or a failed `git ls-files` would turn each count
 * into a confident zero. These tests pin that the counters look where the
 * things are, and that the one count with a registry behind it agrees with
 * that registry.
 *
 * Run with: node --test tests/codebase-counts.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COUNTERS,
  PLAN_CODE,
  publicDocs,
  testHeader,
} from '../scripts/lib/codebase-counts.js';
import { RECIPES } from '../capture/recipes/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('every counter returns numbers', () => {
  for (const [name, counter] of Object.entries(COUNTERS)) {
    const values = counter.count();
    assert.ok(Object.keys(values).length > 0, `${name}: no values`);
    for (const [key, value] of Object.entries(values)) {
      assert.ok(
        Number.isInteger(value) && value >= 0,
        `${name}.${key}: ${value}`,
      );
    }
    assert.ok(counter.describe, `${name}: no description`);
  }
});

test('the counters see the codebase', () => {
  // Floors against a broken scan, not targets: each is far below today's value
  // and far above the zero a silently failing scan would return.
  const plan = COUNTERS['plan-codes'].count();
  assert.ok(plan.publicDocs > 50, `public docs: ${plan.publicDocs}`);
  assert.ok(plan.testFiles > 300, `test files: ${plan.testFiles}`);
  assert.ok(
    publicDocs().every((f) => !f.startsWith('docs/plans/')),
    'the private planning tree is not a public doc',
  );
  const box = COUNTERS['box-sizing'].count();
  assert.ok(box.files > 0, 'box-sizing scan found no stylesheet');
});

test('the recipe count is the registry', () => {
  // The one counter with a registry behind it: a recipe module on disk that
  // RECIPES does not list would run nowhere, and the count would say it exists.
  const onDisk = readdirSync(resolve(ROOT, 'capture/recipes'))
    .filter((f) => f.endsWith('.js') && !f.startsWith('_') && f !== 'index.js')
    .map((f) => f.slice(0, -3))
    .sort();
  assert.deepEqual(onDisk, RECIPES.map((r) => r.id).sort());
  assert.equal(COUNTERS['capture-recipes'].count().recipes, RECIPES.length);
});

test('a plan code is the planning alphabet and nothing wider', () => {
  for (const code of ['A7.1', 'A7.R', 'A2', 'B79', 'D34', 'T9', 'C8']) {
    assert.ok(PLAN_CODE.test(`see ${code} here`), code);
  }
  for (const text of ['B2B', 'h1', 'a11y', 'D3js', 'C100', 'rgba(0,0,0,.5)']) {
    assert.ok(!PLAN_CODE.test(text), text);
  }
});

test('the test header is the leading comment and nothing after it', () => {
  assert.equal(testHeader('/** B1 */\nimport x; // B2'), '/** B1 */');
  assert.equal(
    testHeader('#!/usr/bin/env node\n// B1\n// more\ncode // B2'),
    '// B1\n// more',
  );
  assert.equal(testHeader('import x from "y"; /** B1 */'), '');
});

test('the CLI prints every counter and refuses an unknown name', () => {
  const script = resolve(ROOT, 'scripts/count-codebase.js');
  const out = JSON.parse(
    execFileSync(process.execPath, [script, '--json'], { encoding: 'utf8' }),
  );
  assert.deepEqual(Object.keys(out), Object.keys(COUNTERS));
  assert.throws(
    () => execFileSync(process.execPath, [script, 'nope'], { stdio: 'pipe' }),
    /Unknown counter/,
  );
});
