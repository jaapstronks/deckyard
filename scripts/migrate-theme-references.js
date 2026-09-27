#!/usr/bin/env node
/**
 * One-time slug to theme-record migration. Run after schema migration and seed
 * initialization, before starting the UUID-only server.
 *
 *   node scripts/migrate-theme-references.js --check --map /path/to/map.json --settings-org <uuid>
 *   node scripts/migrate-theme-references.js --apply --map /path/to/map.json --settings-org <uuid>
 *
 * The mapping file is { "<organization UUID>": { "old-slug": "record UUID" } }.
 * Core seed slugs resolve from the seeded themes table. An org-specific entry
 * takes precedence, so a historical fork slug can be mapped explicitly. The
 * singleton app_settings row has no organization_id; --settings-org identifies
 * its owner. Theme settings move into that organization and leave the singleton.
 *
 * --check is read-only. --apply validates every reference and target inside one
 * transaction, then updates only changed rows. An unknown reference, invisible
 * UUID, or invalid map aborts all writes and reports table and row ID.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWN = Object.prototype.hasOwnProperty;

/** @param {unknown} value */
function asJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** @param {unknown} value */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the operator's per-organization mapping before querying data. */
export function validateMapping(raw) {
  if (!isObject(raw))
    throw new Error('Mapping must be an object keyed by organization UUID.');
  for (const [org, slugs] of Object.entries(raw)) {
    if (!UUID.test(org) || !isObject(slugs))
      throw new Error(`Invalid mapping organization ${org}.`);
    for (const [slug, id] of Object.entries(slugs)) {
      if (
        !slug ||
        slug === 'default' ||
        UUID.test(slug) ||
        typeof id !== 'string' ||
        !UUID.test(id)
      ) {
        throw new Error(
          `Invalid mapping ${org}/${slug}. Expected a slug and record UUID.`,
        );
      }
    }
  }
  return raw;
}

/**
 * Plan every row before writing. The DB handle may be a transaction. Its reads
 * are intentionally complete: applying after a partial scan is never allowed.
 */
export async function planThemeReferenceMigration(db, mapping, settingsOrg) {
  validateMapping(mapping);
  if (!UUID.test(settingsOrg || ''))
    throw new Error('--settings-org must be an organization UUID.');

  const [
    themes,
    organizations,
    presentations,
    library,
    versions,
    settingsRows,
  ] = await Promise.all([
    db.selectFrom('themes').select(['id', 'slug', 'organization_id']).execute(),
    db.selectFrom('organizations').select(['id', 'settings']).execute(),
    db
      .selectFrom('presentations')
      .select(['id', 'organization_id', 'theme'])
      .execute(),
    db
      .selectFrom('slide_library')
      .select(['id', 'organization_id', 'theme_id'])
      .execute(),
    db
      .selectFrom('presentation_versions')
      .select(['id', 'presentation_id', 'presentation_data'])
      .execute(),
    db.selectFrom('app_settings').select(['id', 'settings']).execute(),
  ]);
  const orgs = new Set(organizations.map((row) => row.id));
  if (!orgs.has(settingsOrg))
    throw new Error(`Settings organization ${settingsOrg} does not exist.`);
  const byId = new Map(themes.map((row) => [row.id, row]));
  const seeds = new Map(
    themes
      .filter((row) => row.organization_id === null)
      .map((row) => [row.slug, row.id]),
  );
  const errors = [];
  const updates = [];
  const counts = {
    presentations: 0,
    slide_library: 0,
    app_settings: 0,
    organizations: 0,
    presentation_versions: 0,
  };

  for (const [org, slugs] of Object.entries(mapping)) {
    if (!orgs.has(org)) errors.push(`map/${org}: organization does not exist`);
    for (const [slug, id] of Object.entries(slugs)) {
      const target = byId.get(id);
      if (
        !target ||
        (target.organization_id !== null && target.organization_id !== org)
      ) {
        errors.push(
          `map/${org}/${slug}: record ${id} is absent or outside the organization`,
        );
      }
    }
  }

  function resolve(value, org, address, { allowDefault = true } = {}) {
    if (value === null || value === undefined || value === '') return value;
    if (typeof value !== 'string') {
      errors.push(`${address}: theme reference is not a string`);
      return value;
    }
    if (value === 'default') {
      if (!allowDefault)
        errors.push(`${address}: setting cannot refer to default recursively`);
      return value;
    }
    if (UUID.test(value)) {
      const row = byId.get(value);
      if (
        !row ||
        (row.organization_id !== null && row.organization_id !== org)
      ) {
        errors.push(
          `${address}: UUID ${value} is absent or outside the organization`,
        );
      }
      return value;
    }
    const mapped = org ? mapping[org]?.[value] : undefined;
    const resolved = mapped || seeds.get(value);
    if (!resolved) {
      errors.push(`${address}: unknown theme slug ${JSON.stringify(value)}`);
      return value;
    }
    const row = byId.get(resolved);
    if (!row || (row.organization_id !== null && row.organization_id !== org)) {
      errors.push(
        `${address}: mapped record ${resolved} is absent or outside the organization`,
      );
      return value;
    }
    return resolved;
  }

  const presentationOrg = new Map(
    presentations.map((row) => [row.id, row.organization_id]),
  );
  for (const row of presentations) {
    const value = resolve(
      row.theme,
      row.organization_id,
      `presentations/${row.id}.theme`,
    );
    if (value !== row.theme) {
      updates.push({
        table: 'presentations',
        id: row.id,
        values: { theme: value },
      });
      counts.presentations++;
    }
  }
  for (const row of library) {
    const value = resolve(
      row.theme_id,
      row.organization_id,
      `slide_library/${row.id}.theme_id`,
    );
    if (value !== row.theme_id) {
      updates.push({
        table: 'slide_library',
        id: row.id,
        values: { theme_id: value },
      });
      counts.slide_library++;
    }
  }
  for (const row of versions) {
    if (!presentationOrg.has(row.presentation_id)) {
      errors.push(
        `presentation_versions/${row.id}: presentation ${row.presentation_id} is absent`,
      );
      continue;
    }
    const data = asJson(row.presentation_data);
    if (!isObject(data)) {
      errors.push(
        `presentation_versions/${row.id}.presentation_data: expected object`,
      );
      continue;
    }
    if (!OWN.call(data, 'theme')) continue;
    const value = resolve(
      data.theme,
      presentationOrg.get(row.presentation_id),
      `presentation_versions/${row.id}.presentation_data.theme`,
    );
    if (value !== data.theme) {
      updates.push({
        table: 'presentation_versions',
        id: row.id,
        values: {
          presentation_data: JSON.stringify({ ...data, theme: value }),
        },
      });
      counts.presentation_versions++;
    }
  }
  for (const row of settingsRows) {
    const data = asJson(row.settings);
    if (!isObject(data)) {
      errors.push(`app_settings/${row.id}.settings: expected object`);
      continue;
    }
    const nextApp = { ...data };
    const org = organizations.find((item) => item.id === settingsOrg);
    const previousOrg = asJson(org.settings ?? {});
    if (!isObject(previousOrg)) {
      errors.push(`organizations/${settingsOrg}.settings: expected object`);
      continue;
    }
    const nextOrg = { ...previousOrg };
    if (OWN.call(data, 'defaultThemeId')) {
      const value = resolve(
        data.defaultThemeId,
        settingsOrg,
        `app_settings/${row.id}.defaultThemeId`,
        { allowDefault: false },
      );
      if (
        OWN.call(previousOrg, 'defaultThemeId') &&
        previousOrg.defaultThemeId !== value
      )
        errors.push(
          `organizations/${settingsOrg}.defaultThemeId: conflicts with app_settings`,
        );
      else nextOrg.defaultThemeId = value;
      delete nextApp.defaultThemeId;
    }
    if (OWN.call(data, 'enabledThemes')) {
      if (!Array.isArray(data.enabledThemes))
        errors.push(`app_settings/${row.id}.enabledThemes: expected array`);
      else {
        const values = data.enabledThemes.map((value, i) =>
          resolve(
            value,
            settingsOrg,
            `app_settings/${row.id}.enabledThemes[${i}]`,
            { allowDefault: false },
          ),
        );
        if (
          OWN.call(previousOrg, 'enabledThemes') &&
          JSON.stringify(previousOrg.enabledThemes) !== JSON.stringify(values)
        )
          errors.push(
            `organizations/${settingsOrg}.enabledThemes: conflicts with app_settings`,
          );
        else nextOrg.enabledThemes = values;
      }
      delete nextApp.enabledThemes;
    }
    if (JSON.stringify(nextApp) !== JSON.stringify(data)) {
      updates.push({
        table: 'app_settings',
        id: row.id,
        values: { settings: JSON.stringify(nextApp) },
      });
      counts.app_settings++;
    }
    if (JSON.stringify(nextOrg) !== JSON.stringify(previousOrg)) {
      updates.push({
        table: 'organizations',
        id: settingsOrg,
        values: { settings: JSON.stringify(nextOrg) },
      });
      counts.organizations++;
    }
  }
  return { ok: errors.length === 0, errors, counts, updates };
}

/** Apply atomically after re-reading and validating under the transaction. */
export async function migrateThemeReferences(
  db,
  mapping,
  settingsOrg,
  { apply = false } = {},
) {
  if (!apply) return planThemeReferenceMigration(db, mapping, settingsOrg);
  return db.transaction().execute(async (trx) => {
    // Block concurrent writes during validation and updates, including theme
    // record changes that could invalidate a target between those two phases.
    for (const table of [
      'themes',
      'organizations',
      'presentations',
      'slide_library',
      'presentation_versions',
      'app_settings',
    ]) {
      const { sql } = await import('kysely');
      await sql
        .raw(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`)
        .execute(trx);
    }
    const plan = await planThemeReferenceMigration(trx, mapping, settingsOrg);
    if (!plan.ok) return plan;
    for (const update of plan.updates)
      await trx
        .updateTable(update.table)
        .set(update.values)
        .where('id', '=', update.id)
        .execute();
    return plan;
  });
}

/** CLI arguments are strict to avoid accidental writes. */
export function parseArgs(argv) {
  const out = { apply: false, map: null, settingsOrg: null };
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check' || arg === '--apply') {
      if (mode) throw new Error('Choose exactly one of --check or --apply.');
      mode = arg;
      out.apply = arg === '--apply';
    } else if (arg === '--map' || arg === '--settings-org') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--'))
        throw new Error(`${arg} needs a value.`);
      const key = arg === '--map' ? 'map' : 'settingsOrg';
      if (out[key]) throw new Error(`${arg} was provided twice.`);
      out[key] = argv[++i];
    } else throw new Error(`Unknown argument ${arg}.`);
  }
  if (!mode || !out.map || !out.settingsOrg)
    throw new Error(
      'Usage: --check|--apply --map <file.json> --settings-org <organization UUID>',
    );
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mapping = validateMapping(JSON.parse(await readFile(args.map, 'utf8')));
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  );
  await loadDotEnv(repoRoot);
  const { initializeDatabase, closeDatabase } =
    await import('../server/db/client.js');
  const db = await initializeDatabase();
  try {
    const report = await migrateThemeReferences(db, mapping, args.settingsOrg, {
      apply: args.apply,
    });
    for (const [table, count] of Object.entries(report.counts))
      console.log(
        `${table}: ${count} row(s) ${args.apply && report.ok ? 'changed' : 'to change'}`,
      );
    for (const error of report.errors) console.error(error);
    if (!report.ok) process.exitCode = 1;
    else console.log(args.apply ? 'Applied.' : 'Check passed; no writes made.');
  } finally {
    await closeDatabase();
  }
}

if (isCli(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
