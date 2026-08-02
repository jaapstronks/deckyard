#!/usr/bin/env node
/**
 * Hold the in-memory test double against the schema the migrations produce.
 *
 * `tests/helpers/fake-db.js` carries two hand-written tables that claim to
 * mirror the database: `UNIQUE_CONSTRAINTS` (what an insert must collide on)
 * and `JSONB_COLUMNS` (what round-trips through JSON on write and read).
 * Nothing checked that claim, and #423 is what that costs: `acquireSlideLock`
 * needed an `ON CONFLICT` path, which meant teaching the double what the
 * constraint was — in the same PR as the fix. A double you extend when you need
 * it proves only what you put in.
 *
 * The failure this closes is quiet by construction. A migration changes a
 * constraint, the double keeps enforcing the old one, and every test that
 * exercises the upsert stays green on a reality that no longer exists.
 *
 * Run it against a database the migrations have been applied to; in CI that is
 * the same `migrations` job that runs the smoke test, which leaves the schema
 * fully migrated behind it. See docs/plans/briefs/postgres-test-infra.md § C.
 *
 * Usage:
 *   DATABASE_NAME=deckyard_migration_smoke node scripts/check-test-double-schema.js
 */

import { fileURLToPath } from 'node:url';

import { sql } from 'kysely';

import { createMigrationDb } from '../server/db/migrate.js';
import { loadDotEnv } from '../server/config/env.js';
import { JSONB_COLUMNS, UNIQUE_CONSTRAINTS } from '../tests/helpers/fake-db.js';

// `fileURLToPath`, not `.pathname`: a URL percent-encodes, so a checkout under
// a directory with a space would hand `loadDotEnv` a path containing `%20` and
// the `.env` would silently not load. Same reason `server/db/migrate.js` uses it.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Unique constraints and unique indexes in the public schema, as
 * `table -> Set<"col,col">`. Both forms count: PostgreSQL enforces
 * `CREATE UNIQUE INDEX` exactly as it enforces a table constraint, and the
 * migrations use both spellings.
 *
 * Primary keys are excluded. They are unique, but the double models them as
 * identity rather than as a collision rule, and listing every `*_pkey` here
 * would drown the real constraints.
 *
 * Partial indexes are excluded too (`indpred IS NULL`). A `UNIQUE ... WHERE`
 * only collides on the rows its predicate selects, while the double enforces
 * its rules unconditionally — counting one as satisfying the other would be a
 * false green of exactly the #423 kind: the check passes, and the tests keep
 * agreeing with a collision rule the database does not apply to every row.
 *
 * The `::text` cast on `attname` is load-bearing: the column is of PostgreSQL's
 * `name` type, and the driver hands a `name[]` back as the raw literal
 * `{a,b}` instead of an array.
 *
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<Map<string, Set<string>>>}
 */
async function realUniques(db) {
  const { rows } = await sql`
    SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      (
        SELECT array_agg(a.attname::text ORDER BY k.ord)
        FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      ) AS columns
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND ix.indisunique
      AND NOT ix.indisprimary
      AND ix.indpred IS NULL
  `.execute(db);

  const out = new Map();
  for (const row of rows) {
    if (!row.columns) continue; // an expression index has no plain column list
    if (!out.has(row.table_name)) out.set(row.table_name, new Set());
    out.get(row.table_name).add(row.columns.join(','));
  }
  return out;
}

/**
 * Every jsonb column in the public schema, as `table -> Set<column>`.
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<Map<string, Set<string>>>}
 */
async function realJsonbColumns(db) {
  const { rows } = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'jsonb'
  `.execute(db);

  const out = new Map();
  for (const row of rows) {
    if (!out.has(row.table_name)) out.set(row.table_name, new Set());
    out.get(row.table_name).add(row.column_name);
  }
  return out;
}

/**
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<Set<string>>}
 */
async function realTables(db) {
  const { rows } = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `.execute(db);
  return new Set(rows.map((r) => r.tablename));
}

async function main() {
  await loadDotEnv(REPO_ROOT);
  const db = await createMigrationDb();
  /** @type {string[]} */
  const problems = [];

  try {
    const tables = await realTables(db);
    if (!tables.size) {
      throw new Error(
        'The database has no tables. Run the migrations first — this check reads ' +
          'the schema they produce, it does not create it.'
      );
    }

    const uniques = await realUniques(db);
    const jsonb = await realJsonbColumns(db);

    const modelled = new Set([
      ...Object.keys(UNIQUE_CONSTRAINTS),
      ...Object.keys(JSONB_COLUMNS),
    ]);

    // 1. Every table the double models must exist. A renamed or dropped table
    //    leaves a rule that can never fire — the double enforces nothing and
    //    says nothing.
    for (const table of [...modelled].sort()) {
      if (!tables.has(table)) {
        problems.push(
          `table "${table}" is modelled by the double but does not exist in the schema`
        );
      }
    }

    // 2. Every unique the double enforces must exist, column for column. This
    //    is the #423 shape: the double had the right table and the wrong
    //    columns, and every ON CONFLICT test agreed with it.
    for (const [table, constraints] of Object.entries(UNIQUE_CONSTRAINTS)) {
      if (!tables.has(table)) continue; // already reported above
      const actual = uniques.get(table) || new Set();
      for (const columns of constraints) {
        const key = columns.join(',');
        if (actual.has(key)) continue;
        problems.push(
          `${table}: the double enforces UNIQUE (${columns.join(', ')}), which the schema does not have.\n` +
            `    the schema has: ${
              actual.size ? [...actual].map((c) => `(${c.split(',').join(', ')})`).join(', ') : '(no non-primary uniques)'
            }`
        );
      }
    }

    // 3. Every column the double round-trips as JSON must actually be jsonb,
    //    or the double parses something PostgreSQL never serialized.
    for (const [table, columns] of Object.entries(JSONB_COLUMNS)) {
      if (!tables.has(table)) continue;
      const actual = jsonb.get(table) || new Set();
      for (const column of columns) {
        if (actual.has(column)) continue;
        problems.push(
          `${table}.${column}: the double treats it as jsonb, but it is not a jsonb column`
        );
      }
    }

    // 4. And the other way, for the tables the double models: a jsonb column it
    //    does not know about is one it hands back as a string where production
    //    hands back an object.
    for (const table of [...modelled].sort()) {
      if (!tables.has(table)) continue;
      const declared = new Set(JSONB_COLUMNS[table] || []);
      for (const column of [...(jsonb.get(table) || [])].sort()) {
        if (declared.has(column)) continue;
        problems.push(
          `${table}.${column} is jsonb in the schema but not in JSONB_COLUMNS — ` +
            'the double will hand it back as a string where production hands back an object'
        );
      }
    }

    if (problems.length) {
      throw new Error(
        `The test double and the migrated schema disagree in ${problems.length} place(s):\n\n` +
          problems.map((p) => `  - ${p}`).join('\n') +
          '\n\nFix tests/helpers/fake-db.js to match the migrations. If a migration ' +
          'changed a constraint, every test that exercises that upsert has been ' +
          'passing against the old shape.'
      );
    }

    const uniqueCount = Object.values(UNIQUE_CONSTRAINTS).flat().length;
    const jsonbCount = Object.values(JSONB_COLUMNS).flat().length;
    console.log(
      `✓ the test double agrees with the schema: ${uniqueCount} unique constraint(s) ` +
        `and ${jsonbCount} jsonb column(s) across ${modelled.size} table(s).`
    );
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
