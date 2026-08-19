#!/usr/bin/env node
/**
 * Verify the identity dual keys on a live instance (T10, PR G).
 *
 * The operator-facing half of {@link module:storage/identity-verification} —
 * the same check `tests/pg/identity-verification.pgtest.js` runs against a
 * seeded scratch database, pointed at a real one. Run it after deploying the
 * identity migrations (062, 063, 067) to confirm they landed on every row:
 *
 *     node scripts/verify-identity-migration.js
 *
 * It is read-only. Running it twice tells you the same thing twice.
 *
 * Exit codes:
 *   0 — every linked row agrees with its `users` row (repairable `unlinked`
 *       rows may still be reported; they are not wrong today).
 *   1 — at least one row names two different people, or the check could not run.
 *
 * `--strict` also fails on repairable `unlinked` rows, for a deploy pipeline
 * that wants the backfill to be provably complete rather than merely harmless.
 */

import {
  initializeDatabase,
  closeDatabase,
  isDatabaseAvailable,
} from '../server/db/client.js';
import {
  verifyIdentityConsistency,
  formatIdentityReport,
} from '../server/storage/identity-verification.js';

async function main() {
  const strict = process.argv.includes('--strict');

  await initializeDatabase();
  if (!isDatabaseAvailable()) {
    console.error(
      'No database configured — set DATABASE_URL or the DATABASE_* variables.',
    );
    process.exitCode = 1;
    return;
  }

  const report = await verifyIdentityConsistency();
  for (const line of formatIdentityReport(report)) console.log(line);

  if (!report.ok) {
    process.exitCode = 1;
    return;
  }
  if (strict && report.unlinked > 0) {
    console.error(
      `--strict: ${report.unlinked} row(s) could be linked but are not. Re-run the migrations.`,
    );
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (err) {
  console.error('Identity verification failed to run:', err);
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => {});
}
