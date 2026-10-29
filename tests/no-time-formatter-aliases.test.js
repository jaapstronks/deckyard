/**
 * Guard: one canonical name and one definition per time/date/duration
 * formatter in the client format family (A7.21 PR B, decision D30).
 *
 * The client `lib/format/` family had drifted into two spellings and several
 * same-named local redefinitions:
 *   - `fmtRelativeTime` (user-format.js) alongside `formatRelativeTime`;
 *   - `fmtDate` (format.js, my-data.js) alongside the `format*` prefix;
 *   - local `formatDate` / `formatDuration` copies in analytics views.
 *
 * Each formatter now has exactly one definition in one canonical module; the
 * `fmt*` spelling is retired. A second accepted spelling or a same-named local
 * copy is tolerance-creep (maintaining.md § beta doctrine), so this gate fails if
 * one is reintroduced.
 *
 * Scope is the client tree only: the server and shared trees carry their own,
 * unrelated `formatDuration` (server/storage/analytics/weekly-summary.js,
 * shared/slide-timing.js) — a different concept boundary, out of this family.
 *
 * Relative time is stricter still (B148 batch14): a same-named copy was only
 * part of the drift. Three of four relative-time formatters had other names
 * (`formatTimeAgo`, `formatRelativeDate`, an inline closure) and three key
 * sets, so the locales spelled one concept up to three ways and never
 * pluralized. `formatRelativeTime` now asks `Intl.RelativeTimeFormat`, and
 * the two tests after it pin that no other module builds relative time and
 * no locale carries a key for it.
 *
 * Absolute dates, times and counts follow the UI locale too (B868). A bare
 * `toLocaleDateString()` speaks the browser's language, so a Dutch interface
 * in an English browser showed English dates. The last test pins that only
 * `lib/format/` calls `toLocale*String` or builds an `Intl.DateTimeFormat`,
 * always with a locale, and that no `Intl` number formatter is built without
 * one.
 *
 * Run with: node --test tests/no-time-formatter-aliases.test.js
 */

import { walkFiles } from './helpers/walk-files.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

// Canonical time/date/duration formatters → the one module allowed to define each.
const OWNED = {
  formatRelativeTime: 'client/lib/format/format-time.js',
  formatDate: 'client/lib/format/analytics-format.js',
  formatDuration: 'client/lib/format/analytics-format.js',
  formatDateTime: 'client/lib/format/format.js',
  formatTimeShort: 'client/lib/format/analytics-format.js',
};

// Retired `fmt*` spellings that must not reappear as an identifier anywhere.
const RETIRED = ['fmtDate', 'fmtRelativeTime'];

const clientFiles = walkFiles(path.join(repoRoot, 'client'), {
  extensions: ['.js'],
  skipDirs: ['vendor', 'node_modules'],
  missingOk: true,
});

/** A `function NAME` or `const/let/var NAME =` declaration of NAME. */
function definesName(src, name) {
  const fn = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`);
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=`);
  return fn.test(src) || decl.test(src);
}

test('each time/date/duration formatter has one definition, in its canonical module', () => {
  const violations = [];
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const [name, owner] of Object.entries(OWNED)) {
      if (rel !== owner && definesName(src, name)) {
        violations.push(
          `${rel}: redefines '${name}' — the only definition lives in ${owner}`,
        );
      }
      if (new RegExp(`\\bas\\s+${name}\\b`).test(src)) {
        violations.push(
          `${rel}: aliases something 'as ${name}' — that name has one canonical definition`,
        );
      }
    }
  }
  // Sanity: each canonical module still defines the name it owns, so a future
  // rename of the canonical forces this guard to be updated in step.
  for (const [name, owner] of Object.entries(OWNED)) {
    const src = fs.readFileSync(path.join(repoRoot, owner), 'utf8');
    assert.ok(definesName(src, name), `${owner} must define ${name}`);
  }
  assert.equal(
    violations.length,
    0,
    `time/date/duration formatter drift:\n  ${violations.join('\n  ')}`,
  );
});

test('the retired fmt* formatter spellings stay gone', () => {
  const violations = [];
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const name of RETIRED) {
      if (new RegExp(`\\b${name}\\b`).test(src)) {
        violations.push(
          `${rel}: uses retired '${name}' — the format* spelling is canonical`,
        );
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `retired fmt* spelling reintroduced:\n  ${violations.join('\n  ')}`,
  );
});

const RELATIVE_TIME_OWNER = OWNED.formatRelativeTime;

// A UI key for relative time: `*Ago` (`list.time.daysAgo`) or `*.justNow`.
const RELATIVE_TIME_KEY = /(?:Ago|\.justNow)$/;

test('relative time is built in formatRelativeTime only, without translation keys', () => {
  const violations = [];
  const keyCall = /\bt\(\s*['"`]([^'"`]+)['"`]/g;
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (rel === RELATIVE_TIME_OWNER) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (/\bIntl\.RelativeTimeFormat\b/.test(src)) {
      violations.push(
        `${rel}: builds Intl.RelativeTimeFormat — call formatRelativeTime from ${RELATIVE_TIME_OWNER}`,
      );
    }
    for (const [, key] of src.matchAll(keyCall)) {
      if (RELATIVE_TIME_KEY.test(key)) {
        violations.push(
          `${rel}: t('${key}') — relative time comes from formatRelativeTime, not a key`,
        );
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `relative-time formatter drift:\n  ${violations.join('\n  ')}`,
  );
});

test('no locale carries a relative-time key', () => {
  const i18nDir = path.join(repoRoot, 'client', 'i18n');
  const violations = [];
  for (const file of walkFiles(i18nDir, { extensions: ['.json'] })) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    for (const key of Object.keys(data)) {
      if (RELATIVE_TIME_KEY.test(key)) violations.push(`${rel}: ${key}`);
    }
  }
  assert.equal(
    violations.length,
    0,
    `relative-time keys in the locales (CLDR supplies the wording):\n  ${violations.join('\n  ')}`,
  );
});

const FORMAT_DIR = 'client/lib/format/';

// `.toLocaleString(`, `.toLocaleDateString(`, `.toLocaleTimeString(` and the
// first argument up to the next comma or closing paren.
const TO_LOCALE_CALL = /\.toLocale(?:Date|Time)?String\(\s*([^,)]*)/g;
const INTL_CALL = /\bIntl\.(?:DateTimeFormat|NumberFormat)\(\s*([^,)]*)/g;
// Dates have one formatter, so a view never builds its own date format.
const INTL_DATE_CALL = /\bIntl\.DateTimeFormat\(/g;

/** True when a captured first argument names no locale. */
function namesNoLocale(arg) {
  const a = arg.trim();
  return a === '' || a === 'undefined' || a === '[]';
}

test('dates, times and counts are formatted in the UI locale, inside lib/format only', () => {
  const violations = [];
  for (const file of clientFiles) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    for (const [call, arg] of src.matchAll(TO_LOCALE_CALL)) {
      if (!rel.startsWith(FORMAT_DIR)) {
        violations.push(
          `${rel}: '${call.trim()}' — format through ${FORMAT_DIR} (formatDate, formatDateTime, formatCount)`,
        );
      } else if (namesNoLocale(arg)) {
        violations.push(
          `${rel}: '${call.trim()}' without a locale — pass getUiLocale()`,
        );
      }
    }
    for (const [call] of src.matchAll(INTL_DATE_CALL)) {
      if (!rel.startsWith(FORMAT_DIR)) {
        violations.push(
          `${rel}: '${call.trim()}' — format through ${FORMAT_DIR} (formatDate, formatDateTime)`,
        );
      }
    }
    for (const [call, arg] of src.matchAll(INTL_CALL)) {
      if (namesNoLocale(arg)) {
        violations.push(
          `${rel}: '${call.trim()}' without a locale — pass getUiLocale()`,
        );
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `locale-less date/number formatting (follows the browser, not the UI):\n  ${violations.join('\n  ')}`,
  );
});
