/**
 * Guard: the labeled-checkbox wrapper vocabularies are built by one helper.
 *
 * The settings/modal surfaces grew the same "checkbox + label (+ help)" recipe
 * under four re-spelled wrapper classes (A7.16 cluster 9). The label-wrapping
 * ones now come from `labeledCheckbox` (`client/lib/dom/labeled-checkbox.js`),
 * which takes the class as a `className` parameter so each surface keeps its own
 * visual. This gate keeps the markup from being hand-rolled again: the migrated
 * wrapper classes may not appear as a raw `class:` literal in client code — they
 * must be passed to `labeledCheckbox({ className })` instead.
 *
 * Scope note: this targets the label-wrapping vocabularies that were migrated.
 * The `.form-group form-group-checkbox` modal pattern (a `<div>` wrapper with a
 * sibling `<label for>`) is a structurally different recipe and is intentionally
 * NOT built by this helper, so it is not gated here.
 *
 * Run with: node --test tests/labeled-checkbox-single-builder.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const CLIENT_DIR = path.join(repoRoot, 'client');
const HELPER = 'client/lib/dom/labeled-checkbox.js';

// The migrated wrapper classes. Written as a raw `class:` literal, each means a
// hand-rolled labeled checkbox that should go through labeledCheckbox instead.
const MIGRATED_CLASSES = [
  'admin-checkbox-item',
  'form-checkbox-row',
  'api-key-permission-checkbox',
];

// `class: 'admin-checkbox-item'` — the h() attribute form. The helper passes the
// class as `className:`, so its own call sites never match this.
const RAW_CLASS = new RegExp(
  `\\bclass:\\s*['"\`](?:${MIGRATED_CLASSES.join('|')})['"\`]`
);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('migrated labeled-checkbox classes are only built via labeledCheckbox()', () => {
  const violations = [];
  for (const file of walk(CLIENT_DIR)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (rel === HELPER) continue;
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (RAW_CLASS.test(line)) violations.push(`${rel}:${i + 1}  ${trimmed.trim()}`);
      });
  }

  assert.equal(
    violations.length,
    0,
    'Build labeled checkboxes with labeledCheckbox({ className }) ' +
      `(client/lib/dom/labeled-checkbox.js), not a hand-rolled label:\n  ${violations.join('\n  ')}`
  );
});

test('the labeledCheckbox helper still exists', () => {
  assert.ok(
    fs.existsSync(path.join(repoRoot, HELPER)),
    `${HELPER} must exist — the gate points at it.`
  );
});
