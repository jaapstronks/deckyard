/**
 * Per-row verification of the identity dual keys (T10, PR G).
 *
 * The epic's migrations (062 collaborators, 063 presentations, 067
 * `user_settings`) each put a nullable `users.id` beside an existing e-mail
 * column and backfilled it. The backfills ran; this module is the part that
 * says so — one read-only pass that checks, per row, that the two halves of
 * every dual key still agree:
 *
 *   > **id present ⇒ the e-mail column equals that user's current address.**
 *
 * That invariant is what lets the reads key on the id and still let a human
 * read the e-mail column and believe it. The facades maintain it by re-stamping
 * the e-mail whenever they write by id (see `writeUserSettings` in
 * storage/settings.js); nothing has been checking that they always do.
 *
 * ## The four buckets, and which ones are defects
 *
 * Every row with an id/e-mail pair lands in exactly one:
 *
 *  - **linked** — id present, e-mail matches `users.email`. The healthy state.
 *  - **external** — id NULL *and* no `users` row for the e-mail. Also healthy,
 *    and deliberately so: external collaborators (invited by address, never an
 *    account here), the shared `anonymous` settings bucket, and rows imported
 *    off disk by migration 059 live here permanently
 *    ({@link module:storage/identity-resolver}).
 *  - **unlinked** — id NULL *while* a `users` row for that e-mail exists. Not
 *    corruption and not a wrong answer today (the e-mail fallback still finds
 *    the row), but it is a row the backfill should have caught: it will silently
 *    stop matching the moment that person renames. **Repairable**, and the
 *    repair is the migration's own UPDATE.
 *  - **mismatched** — id present, e-mail column names somebody else. This is the
 *    real defect: two identifiers pointing at two different people in one row,
 *    with the reads following the id and every human-facing surface following
 *    the e-mail. **Not auto-repairable** — which of the two is right is a
 *    judgement call, so the report names the row and stops.
 *
 * A missing `users` row for a *present* id cannot occur: all three columns are
 * `REFERENCES users(id) ON DELETE SET NULL`. The join is an inner join for that
 * reason, and a row that somehow escapes it would surface as mismatched.
 *
 * ## Why a module and not a script
 *
 * One implementation, two entry points, because the same question is asked in
 * two places and must not be answered twice: `tests/pg/identity-verification.pgtest.js`
 * asks it of a seeded scratch database in CI, and
 * `scripts/verify-identity-migration.js` asks it of a live instance after a
 * deploy. A boot-check was the third candidate and is deliberately not built:
 * this is a full-table scan whose answer changes only when a migration or a
 * write path changes, so paying for it on every boot buys nothing that an
 * operator running the script after a migration does not already get.
 *
 * The pass is read-only, so re-running it is a no-op by construction.
 *
 * @module storage/identity-verification
 */

import { sql } from 'kysely';
import { withDbGuard } from './utils/db-guard.js';

/**
 * The dual keys this pass verifies: one entry per (id column, e-mail column)
 * pair that the epic created.
 *
 * @type {readonly {table: string, idColumn: string, emailColumn: string, label: string}[]}
 */
export const IDENTITY_DUAL_KEYS = Object.freeze([
  {
    table: 'presentations',
    idColumn: 'owner_user_id',
    emailColumn: 'owner_email',
    label: 'presentation owner',
  },
  {
    table: 'presentations',
    idColumn: 'created_by_user_id',
    emailColumn: 'created_by',
    label: 'presentation creator',
  },
  {
    table: 'presentations',
    idColumn: 'updated_by_user_id',
    emailColumn: 'updated_by',
    label: 'presentation last editor',
  },
  {
    table: 'presentation_versions',
    idColumn: 'created_by_user_id',
    emailColumn: 'created_by',
    label: 'version author',
  },
  {
    table: 'presentation_collaborators',
    idColumn: 'user_id',
    emailColumn: 'user_email',
    label: 'collaborator',
  },
  {
    table: 'user_settings',
    idColumn: 'user_id',
    emailColumn: 'email',
    label: 'user settings',
  },
  {
    table: 'presentations',
    idColumn: 'trashed_by_user_id',
    emailColumn: 'trashed_by',
    label: 'presentation trasher',
  },
  {
    table: 'slide_library',
    idColumn: 'created_by_user_id',
    emailColumn: 'created_by',
    label: 'slide library creator',
  },
  {
    table: 'slide_library',
    idColumn: 'updated_by_user_id',
    emailColumn: 'updated_by',
    label: 'slide library last editor',
  },
  {
    table: 'slide_collections',
    idColumn: 'created_by_user_id',
    emailColumn: 'created_by',
    label: 'slide collection creator',
  },
  {
    table: 'slide_collections',
    idColumn: 'updated_by_user_id',
    emailColumn: 'updated_by',
    label: 'slide collection last editor',
  },
]);

/**
 * How many offending rows a single check reports back in full.
 *
 * The counts are always exact; the samples exist so an operator can go look at
 * an actual row without the report turning into a data dump on a broken
 * instance.
 */
const SAMPLE_LIMIT = 10;

/**
 * @typedef {Object} DualKeyReport
 * @property {string} table
 * @property {string} idColumn
 * @property {string} emailColumn
 * @property {string} label
 * @property {number} total - rows examined (rows with an e-mail value)
 * @property {number} linked - id present and e-mail agrees
 * @property {number} external - id NULL and no `users` row for the e-mail
 * @property {number} unlinked - id NULL while a `users` row exists (repairable)
 * @property {number} mismatched - id present and e-mail names someone else
 * @property {{email: string, userEmail: string|null, userId: string|null}[]} mismatchedSamples
 * @property {{email: string}[]} unlinkedSamples
 * @property {boolean} ok - no mismatched rows
 */

/**
 * Verify one dual key.
 *
 * The whole classification is one scan with a LEFT JOIN on the id and a second
 * on the e-mail, so a table is read once rather than once per bucket and the
 * four counts are guaranteed to come from the same snapshot of it.
 *
 * @param {import('kysely').Kysely<any>} db
 * @param {{table: string, idColumn: string, emailColumn: string, label: string}} key
 * @returns {Promise<DualKeyReport>}
 */
async function verifyDualKey(db, key) {
  const { table, idColumn, emailColumn, label } = key;
  const t = sql.table(table);
  const idCol = sql.ref(idColumn);
  const emailCol = sql.ref(emailColumn);

  const classified = sql`
    SELECT
      CASE
        WHEN r.${idCol} IS NOT NULL
             AND lower(r.${emailCol}) IS NOT DISTINCT FROM lower(byid.email)
          THEN 'linked'
        WHEN r.${idCol} IS NOT NULL THEN 'mismatched'
        WHEN byemail.id IS NOT NULL THEN 'unlinked'
        ELSE 'external'
      END AS bucket,
      r.${emailCol} AS row_email,
      byid.email AS user_email,
      r.${idCol} AS user_id
    FROM ${t} r
    LEFT JOIN users byid ON byid.id = r.${idCol}
    LEFT JOIN users byemail ON lower(byemail.email) = lower(r.${emailCol})
    WHERE r.${emailCol} IS NOT NULL
  `;

  const { rows } = await sql`
    SELECT bucket, count(*)::int AS n
    FROM (${classified}) c
    GROUP BY bucket
  `.execute(db);

  const counts = { linked: 0, external: 0, unlinked: 0, mismatched: 0 };
  for (const row of rows) counts[row.bucket] = Number(row.n);

  /** Samples are only fetched for the buckets an operator would act on. */
  const sampleFor = async (bucket) => {
    if (!counts[bucket]) return [];
    const { rows: sampled } = await sql`
      SELECT row_email, user_email, user_id
      FROM (${classified}) c
      WHERE bucket = ${bucket}
      LIMIT ${sql.lit(SAMPLE_LIMIT)}
    `.execute(db);
    return sampled.map((r) => ({
      email: r.row_email,
      userEmail: r.user_email ?? null,
      userId: r.user_id ?? null,
    }));
  };

  const mismatchedSamples = await sampleFor('mismatched');
  const unlinkedSamples = (await sampleFor('unlinked')).map(({ email }) => ({ email }));

  return {
    table,
    idColumn,
    emailColumn,
    label,
    total: counts.linked + counts.external + counts.unlinked + counts.mismatched,
    ...counts,
    mismatchedSamples,
    unlinkedSamples,
    ok: counts.mismatched === 0,
  };
}

/**
 * @typedef {Object} IdentityVerificationReport
 * @property {boolean} ok - no mismatched rows anywhere
 * @property {boolean} available - false when no database handle is installed
 * @property {number} mismatched - total mismatched rows across all keys
 * @property {number} unlinked - total repairable rows across all keys
 * @property {DualKeyReport[]} checks
 */

/**
 * Verify every identity dual key in the database.
 *
 * Read-only: it changes nothing, so calling it twice is a no-op the same way
 * reading a table twice is. With no database handle installed it answers
 * `available: false` with `ok: true` rather than throwing — nothing to check is
 * not the same as a failed check.
 *
 * @returns {Promise<IdentityVerificationReport>}
 */
export async function verifyIdentityConsistency() {
  return withDbGuard(
    { ok: true, available: false, mismatched: 0, unlinked: 0, checks: [] },
    async (db) => {
      const checks = [];
      for (const key of IDENTITY_DUAL_KEYS) {
        checks.push(await verifyDualKey(db, key));
      }
      const mismatched = checks.reduce((n, c) => n + c.mismatched, 0);
      const unlinked = checks.reduce((n, c) => n + c.unlinked, 0);
      return {
        ok: mismatched === 0,
        available: true,
        mismatched,
        unlinked,
        checks,
      };
    }
  );
}

/**
 * Render a report as the lines an operator reads in a terminal.
 *
 * Kept here rather than in the script so the pgtest can assert on the same
 * text an operator will see — a report nobody can read is a check nobody runs.
 *
 * @param {IdentityVerificationReport} report
 * @returns {string[]}
 */
export function formatIdentityReport(report) {
  if (!report.available) {
    return ['No database handle — nothing to verify.'];
  }
  const lines = [];
  for (const c of report.checks) {
    lines.push(
      `${c.label} (${c.table}.${c.idColumn} ↔ ${c.emailColumn}): ` +
        `${c.total} rows — ${c.linked} linked, ${c.external} external, ` +
        `${c.unlinked} unlinked, ${c.mismatched} mismatched`
    );
    for (const s of c.unlinkedSamples) {
      lines.push(`    unlinked: ${s.email} has a users row but no id — re-run the backfill`);
    }
    for (const s of c.mismatchedSamples) {
      lines.push(
        `    MISMATCH: row says ${s.email}, user ${s.userId} is ${s.userEmail ?? '(no users row)'}`
      );
    }
  }
  lines.push(
    report.ok
      ? `OK — every linked row agrees with its users row (${report.unlinked} repairable, 0 mismatched).`
      : `FAILED — ${report.mismatched} row(s) name two different people.`
  );
  return lines;
}
