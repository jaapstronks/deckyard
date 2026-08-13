/**
 * Migration: move instance and per-user settings from JSON files on disk into
 * PostgreSQL.
 *
 * Before this change, `storage/settings.js` wrote instance settings to
 * `server/data/settings.json` and each user's preferences to
 * `server/data/user-settings/<email-slug>.json` with atomic file writes — even
 * on a Postgres install, where that put every setting OUTSIDE the database
 * backups. A redeploy without a persistent volume lost all of it. Settings
 * read/write now routes through the two tables this migration creates.
 *
 * Schema decisions (brief `disk-json-to-postgres.md` § PR 2, decision points 1
 * and 5):
 *  - `app_settings` — migration 001 created a *per-organization* table with only
 *    two of the many settings columns (`supported_slide_langs`, `webhooks`) and
 *    zero calling code. The disk model was single-instance (one settings.json),
 *    so this migration DROPS that partial table and recreates `app_settings` as
 *    a singleton (boolean primary key + CHECK, the same idiom as
 *    `email_template_settings`) holding the whole settings object as one jsonb
 *    bag. The facade normalizes on read, so the bag is stored as-is.
 *  - `user_settings` — new table keyed on the user's e-mail in its OWN column
 *    (not a composite string). Decision point 5: this keeps the key consistent
 *    with today's e-mail-based ACL layer; the later re-key to a user id (the
 *    identity-decoupling epic) becomes one UPDATE per row.
 *
 * The import (see {@link importAppSettingsFromDisk} /
 * {@link importUserSettingsFromDisk}) follows migration 053's precedent: it
 * reads `dataDir()` at `db:migrate` time and is idempotent and non-destructive
 * (`ON CONFLICT DO NOTHING`), so a re-run never clobbers a value changed after
 * the first migrate, and a file-less install is a no-op.
 *
 * The on-disk user-settings filename is an *irreversible* slug of the e-mail
 * (see the frozen {@link emailSlug} below), and the file body never stored the
 * e-mail. The import therefore recovers each real e-mail by going the other
 * way: it slugs every known `users.email` and looks for that file. A file with
 * no matching user (a deleted account) is simply never read — the same
 * orphan-safety migration 053 has.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { dataDir } from '../../config/storage-paths.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('059');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/db/migrations -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Read + parse a JSON file. Returns null on any error so a missing or corrupt
 * file leaves the import a no-op rather than aborting the migration.
 * @param {string} fullPath
 * @returns {Promise<Object|null>}
 */
async function readJsonFile(fullPath) {
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
 * Frozen copy of `safeSlug` (server/utils/slug.js) as it stood when disk writes
 * stopped. The migration must reproduce the exact on-disk filenames, so it
 * carries its own snapshot rather than importing the live (mutable) util — the
 * same self-contained-migration stance migration 058 took with its
 * normalization. Disk writes end with this PR, so the scheme is frozen forever.
 * @param {string} input
 * @returns {string}
 */
function safeSlug(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || 'presentation';
}

/**
 * Frozen copy of `safeEmailSlug` (server/storage/settings.js), matching the
 * filenames the disk-JSON store produced. See {@link safeSlug}.
 * @param {string} email
 * @returns {string}
 */
function emailSlug(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return 'anonymous';
  const mapped = e
    .replaceAll('@', ' at ')
    .replaceAll('.', ' dot ')
    .replaceAll('+', ' plus ');
  return safeSlug(mapped);
}

/**
 * Back-fill the singleton `app_settings` row from `settings.json`. Exported so
 * the pure test suite can drive the import against a temp `DATA_DIR` and a fake
 * db without running the schema DDL.
 *
 * Idempotent and non-destructive: the insert is `ON CONFLICT DO NOTHING`, so a
 * second migrate imports nothing and never overwrites a later edit. The raw
 * parsed object is stored as-is; the facade normalizes on read.
 *
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<{ app: boolean }>}
 */
export async function importAppSettingsFromDisk(db) {
  const obj = await readJsonFile(path.join(dataDir(REPO_ROOT), 'settings.json'));
  if (!obj) return { app: false };
  await db
    .insertInto('app_settings')
    .values({ id: true, settings: JSON.stringify(obj) })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  return { app: true };
}

/**
 * Back-fill `user_settings` from `user-settings/<email-slug>.json`. Recovers the
 * real e-mail per file by slugging every known `users.email` and looking for
 * its file (the filename slug is irreversible). Exported for the pure test.
 *
 * Idempotent and non-destructive: `ON CONFLICT (email) DO NOTHING`.
 *
 * @param {import('kysely').Kysely<any>} db
 * @returns {Promise<{ users: number }>}
 */
export async function importUserSettingsFromDisk(db) {
  const dir = path.join(dataDir(REPO_ROOT), 'user-settings');

  let users;
  try {
    users = await db.selectFrom('users').select(['email']).execute();
  } catch {
    users = [];
  }

  let imported = 0;
  const seen = new Set();
  for (const { email } of users) {
    const key = String(email || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const obj = await readJsonFile(path.join(dir, `${emailSlug(key)}.json`));
    if (!obj) continue;
    await db
      .insertInto('user_settings')
      .values({ email: key, settings: JSON.stringify(obj) })
      .onConflict((oc) => oc.column('email').doNothing())
      .execute();
    imported += 1;
  }
  return { users: imported };
}

export const up = async (db) => {
  // The migration-001 app_settings was a per-organization table with only two
  // settings columns and no calling code. Replace it with a single-row jsonb
  // bag matching the single-instance disk model.
  await db.schema.dropTable('app_settings').ifExists().execute();
  await db.schema
    .createTable('app_settings')
    .ifNotExists()
    .addColumn('id', 'boolean', (col) => col.primaryKey().defaultTo(true))
    .addColumn('settings', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addCheckConstraint('app_settings_singleton', sql`id`)
    .execute();

  // Per-user preferences, keyed on the e-mail in its own column (decision
  // point 5: not a composite string, so the later re-key to a user id is one
  // UPDATE per row).
  await db.schema
    .createTable('user_settings')
    .ifNotExists()
    .addColumn('email', 'text', (col) => col.primaryKey())
    .addColumn('settings', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  const app = await importAppSettingsFromDisk(db);
  const users = await importUserSettingsFromDisk(db);
  log.info(
    `imported ${app.app ? 'the instance settings' : 'no instance settings'}` +
      ` and ${users.users} user-settings row(s)`
  );
};

export const down = async (db) => {
  await db.schema.dropTable('user_settings').ifExists().execute();
  await db.schema.dropTable('app_settings').ifExists().execute();

  // Restore the migration-001 shape so this down is a true inverse (a partial
  // rollback lands back on the per-organization table).
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      supported_slide_langs TEXT[] DEFAULT '{"nl", "en-GB"}',
      webhooks JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `.execute(db);
};
