/**
 * Migration: move admin-customized email templates from a JSON file on disk
 * into PostgreSQL.
 *
 * Before this change, `storage/email-templates.js` wrote instance-level
 * overrides to `server/data/email-templates.json` with an atomic file write —
 * even on a Postgres install, where that put the overrides OUTSIDE the database
 * backups. A redeploy without a persistent volume lost every customization.
 * Template read/write now routes through the two tables this migration
 * creates, so new overrides land in the database. This migration also
 * back-fills whatever was written to disk while the old code path was live.
 *
 * Schema:
 *  - `email_templates` — one row per (type, locale), the customized fields as a
 *    jsonb bag. The bag holds the subset of TEMPLATE_FIELDS the admin actually
 *    overrode (see shared/constants/email-templates.js); an empty override is
 *    represented by the *absence* of a row, matching the old file semantics
 *    where an empty entry was deleted.
 *  - `email_template_settings` — a singleton row (enforced by a boolean primary
 *    key with a CHECK) holding the instance default locale. A missing row means
 *    "unset", which the storage layer reads as the code DEFAULT_LOCALE.
 *
 * The import (see {@link importEmailTemplatesFromDisk}) follows migration 053's
 * precedent: it reads `dataDir()` at `db:migrate` time and is idempotent and
 * non-destructive (`ON CONFLICT DO NOTHING`), so re-running never clobbers a
 * value an admin changed after the first migrate, and a file-less install is a
 * no-op. The migration runner only ever connects to Postgres.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { dataDir } from '../../config/storage-paths.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('058');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/db/migrations -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Read + parse the on-disk email-templates.json. Returns null on any error so a
 * missing or corrupt file leaves the import a no-op rather than aborting the
 * migration.
 * @param {string} fullPath
 * @returns {Promise<Object|null>}
 */
async function readTemplatesFile(fullPath) {
  try {
    const raw = await fs.readFile(fullPath, 'utf8');
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Keep only string field values, trimmed, dropping empties — the same
 * normalization the storage facade applied before writing. Returns a plain
 * object with at least one field, or null when nothing survives.
 *
 * Structural only: the source file was produced by the validated facade, so the
 * type/locale keys are already known-good, and this migration deliberately does
 * not import the (mutable) shared constants to stay frozen.
 * @param {*} fields
 * @returns {Object|null}
 */
function normalizeFields(fields) {
  if (!fields || typeof fields !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Back-fill the two email-template tables from `email-templates.json` in the
 * data directory. Exported so the pure test suite can exercise the import
 * against a temp `DATA_DIR` and a fake db, without running the schema DDL.
 *
 * Idempotent and non-destructive: every insert is `ON CONFLICT DO NOTHING`, so
 * a second migrate imports nothing new and never overwrites a later edit.
 *
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<{ templates: number, defaultLocale: boolean }>}
 */
export async function importEmailTemplatesFromDisk(db) {
  const filePath = path.join(dataDir(REPO_ROOT), 'email-templates.json');
  const config = await readTemplatesFile(filePath);
  if (!config) return { templates: 0, defaultLocale: false };

  let imported = 0;
  const templates = config.templates && typeof config.templates === 'object' ? config.templates : {};
  for (const [type, byLocale] of Object.entries(templates)) {
    if (!byLocale || typeof byLocale !== 'object') continue;
    for (const [locale, fields] of Object.entries(byLocale)) {
      const normalized = normalizeFields(fields);
      if (!normalized) continue;
      await db
        .insertInto('email_templates')
        .values({ type, locale, fields: JSON.stringify(normalized) })
        .onConflict((oc) => oc.columns(['type', 'locale']).doNothing())
        .execute();
      imported += 1;
    }
  }

  let defaultLocaleImported = false;
  if (typeof config.defaultLocale === 'string' && config.defaultLocale.trim()) {
    await db
      .insertInto('email_template_settings')
      .values({ id: true, default_locale: config.defaultLocale.trim() })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    defaultLocaleImported = true;
  }

  return { templates: imported, defaultLocale: defaultLocaleImported };
}

export const up = async (db) => {
  await db.schema
    .createTable('email_templates')
    .ifNotExists()
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('locale', 'text', (col) => col.notNull())
    .addColumn('fields', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('email_templates_pkey', ['type', 'locale'])
    .execute();

  // Singleton: the instance has exactly one default-locale row. A boolean
  // primary key defaulting to true plus a CHECK that it *is* true is the
  // canonical single-row idiom — a second insert collides on the primary key.
  await db.schema
    .createTable('email_template_settings')
    .ifNotExists()
    .addColumn('id', 'boolean', (col) => col.primaryKey().defaultTo(true))
    .addColumn('default_locale', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addCheckConstraint('email_template_settings_singleton', sql`id`)
    .execute();

  const result = await importEmailTemplatesFromDisk(db);
  log.info(
    `imported ${result.templates} email-template override(s)` +
      (result.defaultLocale ? ' and the instance default locale' : '')
  );
};

export const down = async (db) => {
  await db.schema.dropTable('email_template_settings').ifExists().execute();
  await db.schema.dropTable('email_templates').ifExists().execute();
};
