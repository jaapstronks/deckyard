/**
 * Guard: every *semantic* toast goes through the sugar helpers
 * (`toast.error/.success/.warning/.info`), never the raw two-argument form
 * with a type intent (B74, tighten-scan 2026-08-17).
 *
 * Two minority forms are forbidden on a base `toast(msg, …)` call:
 *
 *   1. a **string** second argument — `toast(msg, 'error')`. The helper's
 *      second parameter is an opts *object* (`client/lib/dom/toast.js`), so a
 *      bare string is read as `opts` and `opts.type` is `undefined` →
 *      `classifyType(undefined)` silently downgrades to `'info'`. This is
 *      exactly the export-modal PDF-failure bug this guard was written to keep
 *      fixed.
 *   2. an **object with a `type:` key** — `toast(msg, { type: 'error' })`. Works,
 *      but it is a second spelling of one concept; the sugar is canonical.
 *
 * The base `toast(msg, { durationMs, id, action, … })` form (opts with no
 * `type:`) stays allowed — an info toast that needs custom opts.
 *
 * Run with: node --test tests/toast-call-shape.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/** The helper implementation itself defines the sugar in terms of raw toast(). */
const SKIP_FILES = new Set(['client/lib/dom/toast.js']);

/** Third-party code we neither wrote nor patch. */
const SKIP_DIRS = new Set(['vendor']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract the top-level arguments of a call whose `(` sits at `openIdx`.
 * Walks the source tracking bracket depth and quotes so a nested
 * `t('key', 'default')` first argument does not confuse the comma split.
 * @returns {string[]|null} trimmed argument texts, or null if unbalanced.
 */
function extractArgs(src, openIdx) {
  let depth = 0;
  let quote = null;
  const args = [];
  let cur = '';
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      cur += ch;
      if (ch === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      if (depth === 1 && ch === '(') continue; // the call's own opening paren
      cur += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) {
        if (cur.trim()) args.push(cur.trim());
        return args;
      }
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 1) {
      args.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  return null;
}

/** `toast(` but not `.toast(` / `makeToast(` / `toast.error(`. */
const TOAST_CALL_RE = /(?<![.\w])toast\s*\(/g;

/**
 * Forbidden minority-form toast sites in one source string.
 * @returns {{ index: number, kind: 'string'|'type', arg: string }[]}
 */
function badToastSites(src) {
  const out = [];
  for (const m of src.matchAll(TOAST_CALL_RE)) {
    const openIdx = m.index + m[0].length - 1;
    const args = extractArgs(src, openIdx);
    if (!args) continue;
    const arg2 = args[1];
    if (!arg2) continue;
    const first = arg2[0];
    if (first === "'" || first === '"' || first === '`') {
      out.push({ index: m.index, kind: 'string', arg: arg2 });
    } else if (first === '{' && /\btype\s*:/.test(arg2)) {
      out.push({ index: m.index, kind: 'type', arg: arg2 });
    }
  }
  return out;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

test('no raw toast(msg, …) with a type intent in client/ — use the sugar helpers', () => {
  const violations = [];
  for (const file of walk(path.join(repoRoot, 'client'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (SKIP_FILES.has(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const site of badToastSites(src)) {
      const how =
        site.kind === 'string'
          ? "string second argument (read as opts → silently 'info')"
          : 'object with a type: key';
      violations.push(`${rel}:${lineOf(src, site.index)}  ${how} — use toast.error/.success/.warning/.info`);
    }
  }
  assert.equal(
    violations.length,
    0,
    `Route semantic toasts through the sugar helpers (client/lib/dom/toast.js):\n  ${violations.join('\n  ')}`
  );
});

test('the detector catches both forbidden forms and passes the allowed ones', () => {
  // Forbidden.
  assert.equal(badToastSites("toast(msg, 'error')").length, 1);
  assert.equal(badToastSites("toast(t('k', 'default'), 'error')").length, 1);
  assert.equal(badToastSites("toast(msg, { type: 'error' })").length, 1);
  assert.equal(badToastSites("toast(msg, { type: 'error', id: 'x' })").length, 1);
  // Allowed.
  assert.equal(badToastSites('toast.error(msg)').length, 0);
  assert.equal(badToastSites("toast.error(msg, { id: 'x' })").length, 0);
  assert.equal(badToastSites('toast(msg)').length, 0);
  assert.equal(badToastSites('toast(msg, { durationMs: 60000 })').length, 0);
  assert.equal(badToastSites("toast(msg, { id: 'notes-save' })").length, 0);
});
