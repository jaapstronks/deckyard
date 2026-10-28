#!/usr/bin/env node
/**
 * The translation-review burndown, against a base commit: the `unreviewed`
 * pairs in `scripts/i18n-source-state.json` may only leave, one pair at a time,
 * never arrive, change or come back.
 *
 * The audit (`i18n-audit.js`) checks the working tree against itself: every
 * pair is either current, still exactly as first observed, or a failure. What
 * it cannot see is the *previous* sidecar, so on its own it would accept a
 * change that records new translations as `unreviewed`, or swaps one reviewed
 * pair for a fresh unknown one at the same total. This script reads the
 * sidecar at the base (`git show <base>:scripts/i18n-source-state.json`) and
 * applies `compareWithBase()` from scripts/lib/i18n-source-state.js — the rule
 * and its tests live there; this file is only the git plumbing.
 *
 * The base is explicit. CI passes the PR's base SHA (or, on a push, the commit
 * before it). Run without one, it compares against the merge base of `HEAD`
 * and `origin/main` — whatever that ref holds locally; it never fetches. An
 * unknown ref fails: a check that skipped itself for lack of history would be
 * green exactly when it saw nothing.
 *
 * Bootstrap is the one exception to "the base has a sidecar", and it must be
 * proven: the file has to be absent from the base's tree. A sidecar that
 * exists at the base but does not parse is an error, not a bootstrap.
 *
 * A fork's merge round can cross upstream's bootstrap: its base (the fork's
 * own main, on an upstream version from before the sidecar) has no file, and
 * the branch merges a tag that has one. Bootstrapping against the fork's old
 * English then reports every string upstream changed since, which says
 * nothing about the fork. So when the base has no sidecar and `HEAD` merged in
 * a commit that has one, that merged commit is the base instead
 * (`mergedSidecarBase`): `HEAD` is judged against upstream's own last state,
 * as strictly as any other change, and only a history with no such merge
 * bootstraps.
 *
 * Usage:
 *   node scripts/i18n-burndown.js [<base-ref>] [--json]
 */

import { execFileSync } from 'node:child_process';

import { REPO_ROOT } from './lib/i18n-fs.js';
import { isCli } from './lib/is-cli.js';
import { parseArgs } from './lib/cli-args.js';
import { LOCALE_IDS, REFERENCE_LOCALE } from './lib/i18n-locales.js';
import {
  SOURCE_STATE_REL,
  compareWithBase,
  parseSourceState,
  readSourceState,
} from './lib/i18n-source-state.js';

/**
 * @param {string[]} args
 * @param {string} [cwd] - the repository to ask; a test points it at a fixture
 * @returns {string}
 */
function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Resolve a ref to a commit SHA, or throw with a message that says what to do.
 * @param {string} ref
 * @param {string} [cwd]
 * @returns {string}
 */
export function resolveCommit(ref, cwd) {
  try {
    return git(
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      cwd,
    ).trim();
  } catch {
    throw new Error(
      `base ref ${JSON.stringify(ref)} is not a commit in this clone — fetch ` +
        'it first (CI: the PR base SHA); the burndown never skips for lack of history',
    );
  }
}

/**
 * The default base for a local run: where this branch left `origin/main`.
 * @returns {string}
 */
export function defaultBase() {
  resolveCommit('origin/main');
  return git(['merge-base', 'HEAD', 'origin/main']).trim();
}

/**
 * The sidecar as the base commit holds it: parsed, or `null` when the path is
 * provably absent from the base's tree.
 * @param {string} commit
 * @param {string} [cwd]
 * @returns {import('./lib/i18n-source-state.js').SourceState|null}
 */
export function stateAtCommit(commit, cwd) {
  const listed = git(
    ['ls-tree', '--name-only', commit, '--', SOURCE_STATE_REL],
    cwd,
  );
  if (!listed.trim()) return null;
  const text = git(['show', `${commit}:${SOURCE_STATE_REL}`], cwd);
  return parseSourceState(text, {
    source: `${SOURCE_STATE_REL} at ${commit.slice(0, 12)}`,
  });
}

/**
 * Whether `commit` is an ancestor of (or equal to) `of`.
 * @param {string} commit
 * @param {string} of
 * @param {string} [cwd]
 * @returns {boolean}
 */
function isAncestor(commit, of, cwd) {
  try {
    git(['merge-base', '--is-ancestor', commit, of], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * The commit a merge brought the sidecar in with, for a base that has none:
 * among the parents of the merges in `base..HEAD` that carry the file and are
 * not already in the base, the one every other such parent descends from (the
 * merged upstream tag, under the PR head and the merge commit that contain
 * it). `null` when `HEAD` merged no such commit, which leaves a real
 * bootstrap. Two unrelated candidates are an error: which one `HEAD` should be
 * held to is not for this script to guess.
 * @param {string} base - a commit without the sidecar
 * @param {string} [cwd]
 * @returns {string|null}
 */
export function mergedSidecarBase(base, cwd) {
  const candidates = [];
  const merges = git(
    ['rev-list', '--merges', '--parents', `${base}..HEAD`],
    cwd,
  )
    .split('\n')
    .filter(Boolean);
  for (const line of merges) {
    for (const parent of line.split(' ').slice(1)) {
      if (candidates.includes(parent) || isAncestor(parent, base, cwd))
        continue;
      if (stateAtCommit(parent, cwd) !== null) candidates.push(parent);
    }
  }
  const roots = candidates.filter(
    (c) => !candidates.some((o) => o !== c && isAncestor(o, c, cwd)),
  );
  if (roots.length > 1)
    throw new Error(
      `the base has no ${SOURCE_STATE_REL} and HEAD merged it in from ` +
        `${roots.length} unrelated commits (${roots.map((r) => r.slice(0, 12)).join(', ')}); ` +
        'pass the one to compare with as the base ref',
    );
  return roots[0] || null;
}

/**
 * Every locale's merged dictionary as the base commit holds it — what a
 * bootstrap's `unreviewed` hashes must fingerprint.
 * @param {string} commit
 * @returns {{reference: Record<string,string>, translations: Record<string, Record<string,string>>}}
 */
export function dictionariesAtCommit(commit) {
  const load = (locale) => {
    const merged = {};
    const files = git([
      'ls-tree',
      '--name-only',
      commit,
      '--',
      `client/i18n/${locale}/`,
    ])
      .split('\n')
      .filter((f) => f.endsWith('.json'));
    for (const file of files)
      Object.assign(merged, JSON.parse(git(['show', `${commit}:${file}`])));
    return merged;
  };
  const translations = {};
  for (const locale of LOCALE_IDS)
    if (locale !== REFERENCE_LOCALE) translations[locale] = load(locale);
  return { reference: load(REFERENCE_LOCALE), translations };
}

/**
 * The commit to compare with and its sidecar: `commit` itself, or, when it
 * has no sidecar and `HEAD` merged one in, the merged commit.
 * @param {string} commit
 * @param {string} [cwd]
 * @returns {{base: string, state: import('./lib/i18n-source-state.js').SourceState|null, crossed: string|null}}
 */
export function resolveBaseState(commit, cwd) {
  const state = stateAtCommit(commit, cwd);
  if (state !== null) return { base: commit, state, crossed: null };
  const merged = mergedSidecarBase(commit, cwd);
  if (merged === null) return { base: commit, state: null, crossed: null };
  return {
    base: merged,
    state: stateAtCommit(merged, cwd),
    crossed: commit,
  };
}

/**
 * Compare the working tree's sidecar with the one at `ref`.
 * @param {string} [ref] - defaults to the merge base with `origin/main`
 * @returns {Promise<ReturnType<typeof compareWithBase> & {base: string, crossed: string|null}>}
 */
export async function runBurndown(ref) {
  const commit = ref ? resolveCommit(ref) : defaultBase();
  const { base: compared, state: base, crossed } = resolveBaseState(commit);
  const head = await readSourceState();
  const result = compareWithBase({
    base,
    head,
    baseInput: base === null ? dictionariesAtCommit(compared) : undefined,
  });
  return { base: compared, crossed, ...result };
}

const USAGE = 'node scripts/i18n-burndown.js [<base-ref>] [--json]';

async function main(argv = process.argv.slice(2)) {
  const { flags, positional } = parseArgs(argv, {
    usage: USAGE,
    flags: ['--json'],
    maxPositional: 1,
  });
  let result;
  try {
    result = await runBurndown(positional[0]);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
  const failed = result.violations.length > 0;
  if (flags.has('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return failed ? 1 : 0;
  }
  const at = result.base.slice(0, 12);
  if (result.crossed)
    console.log(
      `no ${SOURCE_STATE_REL} at ${result.crossed.slice(0, 12)}; ` +
        `comparing with ${at}, the merged commit that brought it in.`,
    );
  if (result.mode === 'bootstrap') {
    console.log(
      `i18n burndown — no ${SOURCE_STATE_REL} at ${at}: bootstrap. ` +
        `${result.headUnreviewed} unreviewed record(s) checked against the base text, ` +
        `${result.headReviewed} reviewed.`,
    );
  } else {
    console.log(
      `i18n burndown against ${at}: unreviewed ${result.baseUnreviewed} → ` +
        `${result.headUnreviewed} (${result.promoted} reviewed, ${result.removed} removed).`,
    );
  }
  if (!failed) {
    console.log('✓ the unreviewed debt only shrank, pair by pair');
    return 0;
  }
  console.log(`\n✗ ${result.violations.length} burndown violation(s):\n`);
  for (const v of result.violations.slice(0, 40))
    console.log(`  ${v.locale}  ${v.key}  ${v.kind}: ${v.detail}`);
  if (result.violations.length > 40)
    console.log(
      `  … ${result.violations.length - 40} more (--json lists every one)`,
    );
  return 1;
}

if (isCli(import.meta.url)) {
  process.exitCode = await main();
}
