#!/usr/bin/env node

/**
 * Check this installation's configuration without starting the server.
 *
 * Usage:
 *   npm run doctor            # one line per check; exit 1 when any failed
 *   npm run doctor -- --json  # the same findings as JSON, for an agent
 *
 * In a container: `node scripts/doctor.js`. Reads `.env` the way the server
 * does. Runbook: docs/ops/doctor.md.
 */

// Load configuration before any dependency snapshots process.env.
import '../server/config/bootstrap-env.js';

import { parseArgs } from 'node:util';

import { isCli } from './lib/is-cli.js';

/** The report is the only thing on stdout, so `--json` pipes cleanly. */
const print = (text) => process.stdout.write(`${text}\n`);

async function main() {
  const { values } = parseArgs({ options: { json: { type: 'boolean' } } });
  // The server's own logging (db connects, provider init) goes to stderr.
  console.log = console.error;

  // Imported here, not above: a module that refuses its env at import time
  // (a relative DECKYARD_CUSTOM_DIR, say) is then one red line, not a trace.
  let doctor;
  try {
    doctor = await import('../server/doctor/index.js');
  } catch (err) {
    const report = [
      {
        id: 'startup',
        label: 'Startup',
        status: 'fail',
        message: String(err?.message || err),
      },
    ];
    print(
      values.json
        ? JSON.stringify(report, null, 2)
        : `✗ Startup  ${report[0].message}`,
    );
    process.exitCode = 1;
    return;
  }

  const { repoRoot } = await import('../server/config/paths.js');
  const { closeStorage } = await import('../server/storage/lifecycle.js');
  const report = await doctor.runDoctor({ repoRoot });
  await closeStorage();
  print(
    values.json
      ? JSON.stringify(report, null, 2)
      : doctor.formatDoctorReport(report),
  );
  process.exitCode = doctor.doctorExitCode(report);
}

if (isCli(import.meta.url)) await main();
