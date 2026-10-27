/**
 * i18n hardcoded-copy and orphan-key gate.
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
 * The mirror-image leak is an *orphan* key: an entry left in all 12 locale JSONs
 * after its call site moved or died. It breaks nothing at runtime, which is
 * exactly why 268 of them accumulated unnoticed until the backlog was pruned to
 * zero. Gated here so the count stays there — the check is conservative (any
 * dotted literal anywhere in client/, shared/, server/, custom/ or themes/, and
 * any runtime-built family in DYNAMIC_KEY_PATTERNS, counts as a reference), so a
 * hit is a real leftover rather than a key the scanner failed to see.
 *
 * The third hole is a key built at runtime, `t(`family.${x}`, fallback)`: no
 * static key, so the coverage gate never asks, and the fallback (often the raw
 * token) renders in every locale. Its family must own values in en/ and nl/.
 *
 * Run with: node --test tests/i18n-audit.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectHardcodedHits,
  findOrphanKeys,
  findRuntimeKeyGaps,
  hardcodedCopyIn,
  hardcodedId,
  isSampleContentException,
} from '../scripts/i18n-audit.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const allowlistPath = path.join(
  repoRoot,
  'scripts',
  'i18n-audit-allowlist.json',
);

const allowlist = JSON.parse(await fs.readFile(allowlistPath, 'utf8'));
const allowed = allowlist.hardcoded || {};
const allowedOrphans = allowlist.orphans || {};
// client/ copy plus each directory-form slide type's authoring.js picker copy.
// Slide-type *sample* content is exempted by provenance rather than by a hand-kept
// allowlist line — see isSampleContentException / docs/reference/slide-type-directory.md.
const hits = await collectHardcodedHits();
const orphans = await findOrphanKeys('en');

describe('i18n hardcoded copy', () => {
  it('no user-facing string bypasses t() without an allowlist entry', () => {
    const unexpected = hits.filter(
      (h) => !(hardcodedId(h) in allowed) && !isSampleContentException(h),
    );
    assert.deepStrictEqual(
      unexpected.map(
        (h) => `${h.file}:${h.line} [${h.prop}] ${JSON.stringify(h.value)}`,
      ),
      [],
      `${unexpected.length} hardcoded user-facing string(s).\n` +
        'Route each through t(key, fallback) and add the key to client/i18n/{en,nl}/.\n' +
        'If it genuinely must not be translated (brand name, language name, syntax\n' +
        `example), add it to ${path.relative(repoRoot, allowlistPath)} with a reason.`,
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
      `${stale.length} stale allowlist entr(ies) — the literal is gone, remove the exemption.`,
    );
  });

  it('every allowlist entry carries a non-empty reason', () => {
    const unreasoned = Object.entries({ ...allowed, ...allowedOrphans })
      .filter(([, reason]) => !String(reason || '').trim())
      .map(([id]) => id);
    assert.deepStrictEqual(
      unreasoned,
      [],
      'allowlist entries must explain themselves',
    );
  });
});

describe('i18n hardcoded-copy detector', () => {
  const values = (src) => hardcodedCopyIn(src, 'x.js').map((h) => h.value);

  it('flags literal copy in a ternary branch of a copy prop', () => {
    // B741: the slide-list "+" tooltips were Dutch in every UI locale.
    const src = `h('button', {
      title:
        a == null
          ? 'Slide invoegen aan het begin'
          : b
            ? 'Nested slide invoegen'
            : 'Slide invoegen tussen slides',
    });`;
    assert.deepStrictEqual(values(src), [
      'Slide invoegen aan het begin',
      'Nested slide invoegen',
      'Slide invoegen tussen slides',
    ]);
  });

  it('passes a ternary whose branches go through t()', () => {
    const src = `h('button', {
      title: a
        ? t('k.a', 'Insert at the start')
        : t('k.b', 'Insert between slides'),
    });`;
    assert.deepStrictEqual(values(src), []);
  });

  it('ignores literals nested in a call and quotes inside a literal', () => {
    const src = `h('div', {
      text: n ? t('k', { one: '1 slide', many: '{count} slides' }, { count: n }) : '',
      placeholder: '{\\n  "title": "Default Title"\\n}',
    });`;
    assert.deepStrictEqual(values(src), []);
  });
});

describe('i18n runtime-built keys', () => {
  it('every t(`family.${x}`) family is declared and has values in en/ and nl/', async () => {
    const gaps = await findRuntimeKeyGaps();
    assert.deepStrictEqual(
      gaps,
      [],
      `${gaps.length} runtime-built key gap(s).\n` +
        'Add the family to DYNAMIC_KEY_PATTERNS (scripts/lib/i18n-keys.js) and give\n' +
        'every member it can build a value in client/i18n/{en,nl}/.',
    );
  });
});

describe('i18n orphan keys', () => {
  it('no key in en/ is referenced nowhere in the source', () => {
    const unexpected = orphans.filter((k) => !(k in allowedOrphans));
    assert.deepStrictEqual(
      unexpected,
      [],
      `${unexpected.length} orphan key(s) in client/i18n/en/.\n` +
        'Delete each from all 12 locales — a dead key ships in every locale file and\n' +
        'makes "how translated are we?" unanswerable. If a key must survive without a\n' +
        `visible call site, add it to ${path.relative(repoRoot, allowlistPath)} under\n` +
        '"orphans" with a reason.',
    );
  });

  it('every orphan exemption still names a key that exists in en/', () => {
    // Same burndown honesty as the hardcoded list: once the key is gone, its
    // exemption has to go too.
    const live = new Set(orphans);
    const stale = Object.keys(allowedOrphans).filter((k) => !live.has(k));
    assert.deepStrictEqual(
      stale,
      [],
      `${stale.length} stale orphan exemption(s) — the key is gone, remove the entry.`,
    );
  });
});

describe('i18n translation freshness in the audit CLI', () => {
  // The rules are pinned in tests/i18n-source-state.test.js against the shared
  // collector. This pins the wiring: the CLI reports the same axis and its exit
  // code follows it, so `npm run i18n:audit` cannot go green on drift the
  // suite would catch.
  it('--json carries the freshness axis and exits 0 only when it is clean', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'i18n-audit.js'), '--json'],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const report = JSON.parse(result.stdout);
    for (const field of ['hardcoded', 'orphans', 'runtimeGaps', 'freshness'])
      assert.ok(field in report, `audit --json lost "${field}"`);
    const { freshness } = report;
    assert.deepStrictEqual(Object.keys(freshness.totals).sort(), [
      'dangling',
      'missing',
      'reviewedCurrent',
      'sourceChanged',
      'sourceMissing',
      'translationChanged',
      'unreviewed',
      'untracked',
    ]);
    assert.equal(freshness.failed, freshness.findings.length > 0);
    const othersFailed =
      report.unexpected.length ||
      report.newOrphans.length ||
      report.runtimeGaps.length;
    assert.equal(result.status, othersFailed || freshness.failed ? 1 : 0);
  });
});
