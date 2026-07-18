#!/usr/bin/env node
/**
 * Regenerate a run's report.md from its stored run.json.
 *
 * Useful when the reporting logic changes and past runs should be re-rendered
 * without paying to re-run them. Costs nothing: it reads only stored results.
 *
 * Usage:
 *   node test-suite/scripts/rebuild-report.js <run-id> [<run-id> ...]
 *   node test-suite/scripts/rebuild-report.js --all
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { RUNS_DIR } from '../lib/config.js';
import { findComparableRun, loadHistory, writeReport } from '../eval/report.js';

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) throw new Error('Pass one or more run ids, or --all');

  const runIds =
    argv[0] === '--all'
      ? (await fs.readdir(RUNS_DIR, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort()
      : argv;

  const history = await loadHistory();

  for (const runId of runIds) {
    const runPath = path.join(RUNS_DIR, runId, 'run.json');
    let run;
    try {
      run = JSON.parse(await fs.readFile(runPath, 'utf8'));
    } catch {
      console.error(`[${runId}] no run.json — skipped`);
      continue;
    }

    // Compare against history entries recorded *before* this run, so a rebuild
    // never diffs a run against its own successors.
    const earlier = history.slice(
      0,
      Math.max(0, history.findIndex((entry) => entry.runId === runId))
    );
    const previous = await findComparableRun(earlier, run.caseIds);

    await writeReport(run, previous, path.join(RUNS_DIR, runId, 'report.md'));
    console.log(
      `[${runId}] rebuilt` + (previous ? ` (compared against ${previous.runId})` : ' (no baseline)')
    );
  }
}

main().catch((err) => {
  console.error(`Rebuild failed: ${err.message}`);
  process.exitCode = 1;
});
