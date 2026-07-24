/**
 * i18n hardcoded-copy gate.
 *
 * `tests/i18n-coverage.test.js` guards the *keys*: everything the code asks for
 * must exist in nl/ and en/. It cannot see copy that never asks — a label or
 * toast written as a literal inside `h(...)` has no key to be missing, so it
 * renders English in all 12 locales and no test notices.
 *
 * This gate closes that hole. `scripts/i18n-audit.js` finds user-facing literals
 * and grades them against `scripts/i18n-audit-allowlist.json`, which lists the
 * legitimate exceptions (brand names, language names shown in their own
 * language, syntax examples) with a reason each. New hardcoded copy fails here.
 *
 * Run with: node --test tests/i18n-audit.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findHardcodedCopy, hardcodedId } from '../scripts/i18n-audit.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(repoRoot, 'client');
const allowlistPath = path.join(repoRoot, 'scripts', 'i18n-audit-allowlist.json');

const allowlist = JSON.parse(await fs.readFile(allowlistPath, 'utf8'));
const allowed = allowlist.hardcoded || {};
const hits = await findHardcodedCopy(clientDir);

describe('i18n hardcoded copy', () => {
  it('no user-facing string bypasses t() without an allowlist entry', () => {
    const unexpected = hits.filter((h) => !(hardcodedId(h) in allowed));
    assert.deepStrictEqual(
      unexpected.map((h) => `${h.file}:${h.line} [${h.prop}] ${JSON.stringify(h.value)}`),
      [],
      `${unexpected.length} hardcoded user-facing string(s).\n` +
        'Route each through t(key, fallback) and add the key to client/i18n/{en,nl}/.\n' +
        'If it genuinely must not be translated (brand name, language name, syntax\n' +
        `example), add it to ${path.relative(repoRoot, allowlistPath)} with a reason.`
    );
  });

  it('every allowlist entry still matches a real literal', () => {
    // Keeps the burndown honest: once a string is translated or deleted, its
    // exemption has to go too, otherwise the list only ever grows.
    const live = new Set(hits.map(hardcodedId));
    const stale = Object.keys(allowed).filter((id) => !live.has(id));
    assert.deepStrictEqual(
      stale,
      [],
      `${stale.length} stale allowlist entr(ies) — the literal is gone, remove the exemption.`
    );
  });

  it('every allowlist entry carries a non-empty reason', () => {
    const unreasoned = Object.entries(allowed)
      .filter(([, reason]) => !String(reason || '').trim())
      .map(([id]) => id);
    assert.deepStrictEqual(unreasoned, [], 'allowlist entries must explain themselves');
  });
});
