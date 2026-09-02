/**
 * The `details` register covers every producer, not just the ones a test
 * happens to serialize.
 *
 * `assertErrorDetails()` runs at the two emission points (`jsonError()` and
 * `AppError.toJSON()`), which is the real contract — but it only fires on a
 * path something actually executes. B208's own inventory measured `details:`
 * under `server/routes/**` and missed two producers that live in
 * `server/storage/**`: the slide-merge `conflict` (a fifth key) and an
 * unregistered payload on a `ValidationError`. Both reached the client in dev
 * as a 500 the moment the assertion went in.
 *
 * So this reads the source instead: every `new <Some>Error(…)` whose details
 * argument is a literal object must name only keys the register permits for
 * that class's code. A non-literal argument (a variable, a spread, a call) is
 * skipped — the runtime assertion is what covers those.
 *
 * Run with: node --test tests/error-details-register-guard.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

import * as errors from '../server/utils/errors.js';
import { SandboxQuotaError } from '../server/storage/presentations/sandbox-quota.js';
import { PAYLOAD_KEYS, LOCATION_KEYS } from '../server/utils/error-details.js';
import { reasonEntry } from '../server/storage/reasons.js';

/**
 * Every `AppError` subclass whose constructor takes `(message, details)`, by
 * name, with the code it serializes as — read off an instance rather than
 * hardcoded, so a renamed code cannot leave this guard stale.
 */
const DETAIL_CARRYING = new Map(
  [
    ...Object.values(errors).filter(
      (v) =>
        typeof v === 'function' &&
        v !== errors.AppError &&
        v.prototype instanceof errors.AppError,
    ),
    SandboxQuotaError,
  ].map((Cls) => [Cls.name, new Cls('probe').code]),
);

/** Argument index the details object sits at, per constructor shape. */
const DETAILS_ARG = (name) => (name === 'AppError' ? 2 : 1);

const FILES = execFileSync('git', ['ls-files', 'server'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.js'));

/**
 * Split a call's argument text into top-level arguments.
 * @param {string} text @returns {string[]}
 */
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') {
        cur += c + (text[i + 1] || '');
        i++;
        continue;
      }
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      cur += c;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * The top-level keys of an object-literal source text, or `null` when the text
 * is not a plain literal this guard can read.
 * @param {string} text @returns {string[]|null}
 */
function literalKeys(text) {
  const src = text.trim();
  if (!src.startsWith('{') || !src.endsWith('}')) return null;
  const inner = src.slice(1, -1);
  if (inner.includes('...')) return null; // a spread: not statically readable
  const keys = [];
  for (const part of splitArgs(inner)) {
    const m = part.trim().match(/^(?:\/\/[^\n]*\n\s*)*['"]?([A-Za-z0-9_$]+)['"]?\s*:/);
    if (m) keys.push(m[1]);
    else {
      const shorthand = part.trim().match(/^([A-Za-z0-9_$]+)$/);
      if (shorthand) keys.push(shorthand[1]);
      else return null; // computed key or something exotic — leave it be
    }
  }
  return keys;
}

/** @returns {Array<{file: string, line: number, cls: string, keys: string[]}>} */
function detailLiterals() {
  const found = [];
  for (const file of FILES) {
    const src = fs.readFileSync(file, 'utf8');
    for (const name of DETAIL_CARRYING.keys()) {
      const re = new RegExp(`new\\s+${name}\\s*\\(`, 'g');
      let m;
      while ((m = re.exec(src))) {
        let i = re.lastIndex;
        let depth = 1;
        let args = '';
        while (i < src.length && depth > 0) {
          const c = src[i];
          if ('([{'.includes(c)) depth++;
          else if (')]}'.includes(c)) depth--;
          if (depth > 0) args += c;
          i++;
        }
        const arg = splitArgs(args)[DETAILS_ARG(name)];
        if (!arg) continue;
        const keys = literalKeys(arg);
        if (!keys) continue;
        found.push({
          file,
          line: src.slice(0, m.index).split('\n').length,
          cls: name,
          keys,
        });
      }
    }
  }
  return found;
}

const LITERALS = detailLiterals();

test('the scan actually finds the known detail-carrying throws', () => {
  // A silent zero-hit scan would make the assertion below vacuously pass.
  assert.ok(
    DETAIL_CARRYING.size >= 5,
    `expected several detail-carrying classes, got ${DETAIL_CARRYING.size}`,
  );
  assert.ok(
    LITERALS.length >= 4,
    `expected the server to build several literal payloads, got ${LITERALS.length}`,
  );
  assert.ok(
    LITERALS.some((h) => h.keys.includes('conflictingSlides')),
    'sanity: the slide-merge conflict payload is one of them',
  );
});

test('every literal error payload names only registered keys', () => {
  const stray = [];
  for (const { file, line, cls, keys } of LITERALS) {
    const code = DETAIL_CARRYING.get(cls);
    const allowed = new Set([
      ...(PAYLOAD_KEYS[code] || []),
      ...(reasonEntry(code) ? LOCATION_KEYS : []),
    ]);
    for (const k of keys) {
      if (!allowed.has(k)) stray.push(`${file}:${line} ${cls} → ${code}.${k}`);
    }
  }
  assert.deepEqual(
    stray,
    [],
    `these payloads are not in the register (server/utils/error-details.js):\n` +
      stray.map((s) => `  - ${s}`).join('\n') +
      `\n\nEither register the key, or move the fact into \`message\`.`,
  );
});
