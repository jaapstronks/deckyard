/**
 * Anchor consistency report — the measurement behind B148.
 *
 * `tests/i18n-coverage.test.js` gates the invariant (one concept, one word,
 * within one locale) against `scripts/i18n-anchor-allowlist.json`. This script
 * is the other half: it shows *what* is on that list and ranks it into the
 * cohorts a translator actually decides in — diacritics dropped, one form left
 * in English, inflection, two different words — so the burndown can be worked
 * a cohort at a time instead of a row at a time.
 *
 * `--apply` reconciles the allowlist with what is live: rows for drift that no
 * longer exists are removed, rows for drift that has appeared are added as
 * `unreviewed`. It never rewrites a reason someone wrote, so a judgement cannot
 * be lost by running it. It cannot be used to launder new drift either: the
 * gate caps how many `unreviewed` rows may exist, so adding one fails the suite
 * exactly as leaving it unlisted would.
 *
 * Usage:
 *   node scripts/i18n-anchor-report.js            # human report
 *   node scripts/i18n-anchor-report.js --json     # machine-readable
 *   node scripts/i18n-anchor-report.js --apply    # reconcile the allowlist
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  I18N_DIR as i18nDir,
  REPO_ROOT as repoRoot,
  loadLocale,
} from './lib/i18n-fs.js';
import { LOCALE_IDS, REFERENCE_LOCALE } from './lib/i18n-locales.js';
import {
  COHORTS,
  UNREVIEWED,
  allowlistRows,
  anchorRowKey,
  cohortOf,
  detectAnchorDrift,
  groupByEnglish,
} from './lib/i18n-anchors.js';
import { isCli } from './lib/is-cli.js';
import { parseArgs } from './lib/cli-args.js';

const ALLOWLIST_PATH = path.join(
  repoRoot,
  'scripts',
  'i18n-anchor-allowlist.json',
);

/** The reason a freshly seeded row carries until someone judges it. */
const SEED_REASON =
  `${UNREVIEWED} — seeded from the B148 baseline measurement; ` +
  'the choice between the two forms has not been made yet.';

/**
 * Load `en/` and every other shipped locale.
 * @returns {Promise<{reference: Record<string, string>, dicts: Record<string, Record<string, string>>}>}
 */
async function loadAll() {
  const reference = await loadLocale(i18nDir, REFERENCE_LOCALE);
  /** @type {Record<string, Record<string, string>>} */
  const dicts = {};
  for (const locale of LOCALE_IDS) {
    if (locale === REFERENCE_LOCALE) continue;
    dicts[locale] = await loadLocale(i18nDir, locale);
  }
  return { reference, dicts };
}

/** @returns {Promise<{anchors: Record<string, {forms: string[], reason: string}>, _README?: string[]}>} */
async function readAllowlist() {
  try {
    return JSON.parse(await fs.readFile(ALLOWLIST_PATH, 'utf8'));
  } catch {
    return { anchors: {} };
  }
}

const README = [
  'Accepted (locale, concept) pairs for the anchor gate in',
  'tests/i18n-coverage.test.js — places where one locale spells one English',
  'concept more than one way. Every row carries its live forms and a reason.',
  '',
  'This is a burndown, not a mute button. A reason starting with',
  `"${UNREVIEWED}" marks a row nobody has judged yet: those must reach zero, and`,
  'the gate fails if their number grows. A judged row says why two forms are',
  'correct — grammatical agreement, or one form being English on purpose — and',
  'stays.',
  '',
  'The "forms" array pins what was allowed. Change either translation and the',
  'row stops matching, so the gate asks again instead of silently covering the',
  'new pair. Rows for drift that no longer exists fail as stale.',
  '',
  'Run `node scripts/i18n-anchor-report.js` for the ranked report, or with',
  '--apply to add newly drifted rows and drop stale ones (reasons are never',
  'rewritten).',
];

/**
 * @param {import('./lib/i18n-anchors.js').AnchorFinding[]} findings
 * @param {Map<string, {forms: string[], reason: string}>} rows
 * @returns {{stale: string[], missing: import('./lib/i18n-anchors.js').AnchorFinding[]}}
 */
function reconcile(findings, rows) {
  const live = new Map(findings.map((f) => [anchorRowKey(f), f]));
  const stale = [...rows.keys()].filter((row) => {
    const finding = live.get(row);
    if (!finding) return true;
    return (
      JSON.stringify(finding.forms) !== JSON.stringify(rows.get(row).forms)
    );
  });
  const missing = findings.filter((f) => {
    const entry = rows.get(anchorRowKey(f));
    return !entry || JSON.stringify(entry.forms) !== JSON.stringify(f.forms);
  });
  return { stale, missing };
}

/** @returns {Promise<number>} process exit code */
async function main() {
  const { flags } = parseArgs(process.argv.slice(2), {
    usage: 'node scripts/i18n-anchor-report.js [--json] [--apply]',
    flags: ['--json', '--apply'],
  });

  const { reference, dicts } = await loadAll();
  const concepts = groupByEnglish(reference);
  const findings = detectAnchorDrift(reference, dicts);
  const allowlist = await readAllowlist();
  const rows = allowlistRows(allowlist);
  const { stale, missing } = reconcile(findings, rows);

  if (flags.has('--apply')) {
    /** @type {Record<string, {forms: string[], reason: string}>} */
    const anchors = {};
    for (const finding of findings) {
      const row = anchorRowKey(finding);
      const existing = rows.get(row);
      const keep =
        existing &&
        JSON.stringify(existing.forms) === JSON.stringify(finding.forms);
      anchors[row] = {
        forms: finding.forms,
        reason: keep ? existing.reason : SEED_REASON,
      };
    }
    const sorted = Object.fromEntries(
      Object.keys(anchors)
        .sort()
        .map((row) => [row, anchors[row]]),
    );
    await fs.writeFile(
      ALLOWLIST_PATH,
      `${JSON.stringify({ _README: README, anchors: sorted }, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `Wrote ${path.relative(repoRoot, ALLOWLIST_PATH)}: ${findings.length} row(s) ` +
        `(+${missing.length} added, -${stale.length} removed).`,
    );
    return 0;
  }

  const byCohort = new Map(COHORTS.map((c) => [c, []]));
  for (const finding of findings) byCohort.get(cohortOf(finding)).push(finding);
  const unreviewed = [...rows.values()].filter((e) =>
    e.reason.startsWith(UNREVIEWED),
  ).length;

  if (flags.has('--json')) {
    console.log(
      JSON.stringify(
        {
          concepts: concepts.size,
          findings: findings.map((f) => ({ ...f, cohort: cohortOf(f) })),
          allowlisted: rows.size,
          unreviewed,
          stale,
          missing: missing.map(anchorRowKey),
        },
        null,
        2,
      ),
    );
    return stale.length || missing.length ? 1 : 0;
  }

  console.log(
    `Anchor consistency — ${concepts.size} English concept(s) under 2+ keys, ` +
      `${findings.length} (locale, concept) pair(s) spelled more than one way.`,
  );
  console.log(
    `Allowlisted: ${rows.size}, of which ${unreviewed} still ${UNREVIEWED}.\n`,
  );
  for (const cohort of COHORTS) {
    const group = byCohort.get(cohort);
    console.log(`## ${cohort} (${group.length})`);
    for (const f of group) {
      console.log(
        `  ${f.locale}  ${JSON.stringify(f.concept)}  ->  ` +
          f.forms.map((x) => JSON.stringify(x)).join(' | '),
      );
    }
    console.log('');
  }
  if (stale.length) {
    console.log(`✗ ${stale.length} stale allowlist row(s):`);
    for (const row of stale) console.log(`  ${row}`);
  }
  if (missing.length) {
    console.log(`✗ ${missing.length} row(s) not allowlisted:`);
    for (const f of missing) console.log(`  ${anchorRowKey(f)}`);
  }
  if (!stale.length && !missing.length) {
    console.log('✓ allowlist matches what is live');
  }
  return stale.length || missing.length ? 1 : 0;
}

if (isCli(import.meta.url)) {
  process.exitCode = await main();
}
