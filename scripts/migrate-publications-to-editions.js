#!/usr/bin/env node
/**
 * One-off conversion of the publications from before editions (T1.5). Run
 * with the server's own env, after the release with migration 105 is
 * deployed and a backup of the database is taken:
 *
 *   node scripts/migrate-publications-to-editions.js            # dry run
 *   node scripts/migrate-publications-to-editions.js --apply
 *
 * Every old `/p/{publishId}-{slug}` link becomes a permanent redirect to the
 * first edition made of its deck; what it does and why is in
 * `server/services/publication-migration.js`. The dry run writes nothing and
 * reports per old id what `--apply` would do. Both print the report as JSON on
 * stdout and a summary on stderr, and exit 2 while any row is blocked, so a
 * blocked row is never mistaken for a finished conversion. Running `--apply`
 * again is safe: converted rows report `already_linked`.
 *
 * Afterwards, `node scripts/sweep-published-previews.js --apply` removes the
 * preview images the old publications left on a remote media origin.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function main() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean' } } });
  // stdout carries the report alone: the server's own log lines (written with
  // console.log) go to stderr with the summary.
  const writeReport = (text) => process.stdout.write(text);
  console.log = (...args) => console.error(...args);
  await loadDotEnv(REPO_ROOT);
  const { initializeStorage, closeStorage } =
    await import('../server/db/lifecycle.js');
  const { pendingMigrationsError } = await import('../server/db/boot-check.js');
  const { initializeMediaProvider } = await import('../server/media/index.js');
  const { initializeThemeSeeds } =
    await import('../server/utils/theme-seeds.js');
  const { migrateLegacyPublications } =
    await import('../server/services/publication-migration.js');

  await initializeStorage();
  try {
    const schemaErr = await pendingMigrationsError();
    if (schemaErr) throw new Error(schemaErr);
    await initializeThemeSeeds();
    await initializeMediaProvider(REPO_ROOT);
    const report = await migrateLegacyPublications(REPO_ROOT, {
      apply: !!values.apply,
    });
    writeReport(`${JSON.stringify(report, null, 2)}\n`);
    const blocked = report.rows.filter((r) => r.outcome === 'blocked');
    console.error(
      `${values.apply ? 'Applied' : 'Dry run'}: ${Object.entries(report.summary)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')}`,
    );
    for (const row of blocked) {
      console.error(
        `blocked ${row.legacyId} (deck ${row.presentationId ?? '-'}): ${row.reason}`,
      );
    }
    if (blocked.length) process.exitCode = 2;
  } finally {
    await closeStorage();
  }
}

if (isCli(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
