#!/usr/bin/env node

/**
 * The seam crossing of a fork's merge round: which files did upstream touch in
 * this round that the fork also diverges on outside what it owns?
 *
 * Usage:
 *   npm run fork:seams -- <upstream-ref> [--from <ref>] [--json]
 *
 * `<upstream-ref>` is the release you merge (or just merged), e.g. `v1.49.0`.
 * The round starts where the fork last synced: the merge base of `HEAD` and the
 * ref before you merge, and after the merge the merge base of the fork's last
 * first-parent commit that did not contain the ref yet. `--from` overrides it.
 *
 * Every hit is classified against `custom/fork.json` (scripts/lib/fork-manifest.js):
 *   - documented seam: a core file fork-setup.md tells a fork to edit;
 *   - declared deviation: a core file the fork patches on purpose, with its reason;
 *   - undeclared: a new core patch or drift. Exit code 1 while any remain, so
 *     the command is a gate in the merge-round checklist.
 *
 * Both forks (ciiic-slides, dreamkit-slides) kept this as a four-line shell
 * recipe in their own FORK.md; what two forks write down separately belongs in
 * the core (B426). Runbook: docs/reference/fork-setup.md § Merge round checklist.
 */

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { isCli } from './lib/is-cli.js';
import {
  DOCUMENTED_SEAMS,
  isForkOwned,
  readForkManifest,
} from './lib/fork-manifest.js';

const USAGE = 'npm run fork:seams -- <upstream-ref> [--from <ref>] [--json]';

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

/** @returns {string[]} */
const lines = (out) => out.split('\n').filter(Boolean);

/**
 * Whether commit `a` is an ancestor of (or equal to) `b`.
 *
 * @param {string} cwd
 * @param {string} a
 * @param {string} b
 */
function isAncestor(cwd, a, b) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * The commit this round starts from: where the fork last synced with upstream.
 *
 * @param {string} cwd
 * @param {string} ref - the upstream release of this round
 * @returns {string} a commit sha
 */
export function roundStart(cwd, ref) {
  const target = git(cwd, ['rev-parse', `${ref}^{commit}`]);
  if (!isAncestor(cwd, target, 'HEAD')) {
    return git(cwd, ['merge-base', 'HEAD', target]);
  }
  // Already merged: step back along the fork's own line to before the merge.
  for (const c of lines(git(cwd, ['rev-list', '--first-parent', 'HEAD']))) {
    if (!isAncestor(cwd, target, c)) return git(cwd, ['merge-base', c, target]);
  }
  throw new Error(
    `${ref} is in HEAD's first-parent line itself; this checkout is upstream, not a fork. Pass --from <ref>.`,
  );
}

/**
 * @typedef {object} SeamHit
 * @property {string} file
 * @property {'documented' | 'deviation' | 'undeclared'} kind
 * @property {string} [why]
 */

/**
 * Classify the files both sides touched.
 *
 * @param {string[]} upstreamTouched - files upstream changed in this round
 * @param {string[]} forkDiverged - files where the fork differs from the upstream ref
 * @param {import('./lib/fork-manifest.js').ForkManifest} manifest
 * @returns {SeamHit[]}
 */
export function classifySeams(upstreamTouched, forkDiverged, manifest) {
  const fork = new Set(forkDiverged.filter((f) => !isForkOwned(manifest, f)));
  return [...new Set(upstreamTouched)]
    .filter((f) => fork.has(f))
    .sort()
    .map((file) => {
      if (Object.hasOwn(DOCUMENTED_SEAMS, file)) {
        return { file, kind: 'documented', why: DOCUMENTED_SEAMS[file] };
      }
      if (Object.hasOwn(manifest.deviations, file)) {
        return { file, kind: 'deviation', why: manifest.deviations[file] };
      }
      return { file, kind: 'undeclared' };
    });
}

/**
 * Core files the fork diverges on that no rule accounts for, whether or not
 * upstream touched them this round.
 *
 * @param {string[]} forkDiverged
 * @param {import('./lib/fork-manifest.js').ForkManifest} manifest
 * @returns {string[]}
 */
export function undeclaredDivergence(forkDiverged, manifest) {
  return forkDiverged
    .filter(
      (f) =>
        !isForkOwned(manifest, f) &&
        !Object.hasOwn(DOCUMENTED_SEAMS, f) &&
        !Object.hasOwn(manifest.deviations, f),
    )
    .sort();
}

/**
 * Run the seam crossing for a checkout.
 *
 * @param {string} cwd - the fork checkout
 * @param {string} ref - the upstream release of this round
 * @param {{ from?: string }} [opts]
 */
export function forkSeams(cwd, ref, { from } = {}) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const manifest = readForkManifest(root);
  const start = from
    ? git(cwd, ['rev-parse', `${from}^{commit}`])
    : roundStart(cwd, ref);
  const upstreamTouched = lines(git(cwd, ['diff', '--name-only', start, ref]));
  // The fork's divergence is measured against the upstream it contains: the
  // new ref once merged, the last sync point before that. Diffing an unmerged
  // fork against the new ref would count every upstream change as fork drift.
  const merged = isAncestor(
    cwd,
    git(cwd, ['rev-parse', `${ref}^{commit}`]),
    'HEAD',
  );
  const synced = merged ? ref : git(cwd, ['merge-base', 'HEAD', ref]);
  const forkDiverged = lines(git(cwd, ['diff', '--name-only', synced, 'HEAD']));
  return {
    ref,
    from: start,
    hits: classifySeams(upstreamTouched, forkDiverged, manifest),
    undeclared: undeclaredDivergence(forkDiverged, manifest),
  };
}

const LABEL = {
  documented: 'documented seam',
  deviation: 'declared deviation',
  undeclared: 'UNDECLARED: new core patch or drift',
};

if (isCli(import.meta.url)) {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: { from: { type: 'string' }, json: { type: 'boolean' } },
    });
  } catch (err) {
    console.error(err.message);
    console.error(`Usage: ${USAGE}`);
    process.exit(1);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) {
    console.error(`Usage: ${USAGE}`);
    process.exit(1);
  }
  let result;
  try {
    result = forkSeams(process.cwd(), positionals[0], { from: values.from });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const open = result.hits.filter((h) => h.kind === 'undeclared');
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `Seam crossing ${result.from.slice(0, 9)}..${result.ref}: ${result.hits.length} file(s) touched by upstream and diverged in the fork.`,
    );
    for (const h of result.hits) {
      console.log(
        `  ${h.file}  (${LABEL[h.kind]}${h.why ? `: ${h.why}` : ''})`,
      );
    }
    const quiet = result.undeclared.filter(
      (f) => !open.some((h) => h.file === f),
    );
    if (quiet.length) {
      console.log(
        `\n${quiet.length} other core file(s) diverge without a declaration (upstream did not touch them this round):`,
      );
      for (const f of quiet) console.log(`  ${f}`);
    }
    if (open.length) {
      console.log(
        `\nFor each UNDECLARED file: brief the change upstream, or add it to "deviations" in custom/fork.json with its reason.`,
      );
    }
  }
  process.exit(open.length ? 1 : 0);
}
