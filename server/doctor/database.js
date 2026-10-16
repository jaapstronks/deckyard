/**
 * Doctor checks against PostgreSQL: reachable, migrated, and holding no
 * theme reference from before the UUID cutover.
 *
 * The same two questions boot asks before it serves, with the same messages
 * (`databaseConnectionError()`, `pendingMigrationsError()`), so a red line
 * here is exactly the boot refusal the operator would otherwise meet.
 */

import {
  databaseConnectionError,
  getDatabaseConfig,
  isDatabaseConnectionError,
} from '../config/database.js';
import { initializeStorage } from '../db/lifecycle.js';
import {
  pendingMigrationsError,
  unmigratedThemeReferencesError,
} from '../db/boot-check.js';
import { ok, fail, skip } from './finding.js';

/**
 * @typedef {import('./finding.js').DoctorContext & {
 *   connect?: () => Promise<void>,
 *   pendingMigrations?: () => Promise<string|null>,
 *   unmigratedThemeReferences?: () => Promise<string|null>,
 * }} DatabaseContext
 */

/** @type {import('./finding.js').DoctorCheck} */
export const databaseCheck = {
  id: 'database',
  label: 'Database',
  /** @param {DatabaseContext} ctx */
  async run({ connect = initializeStorage }) {
    try {
      await connect();
    } catch (err) {
      return fail(
        isDatabaseConnectionError(err)
          ? databaseConnectionError(err)
          : String(err?.message || err),
      );
    }
    const { user, host, port, database } = getDatabaseConfig();
    return ok(`${user}@${host}:${port}/${database}`);
  },
};

/** @type {import('./finding.js').DoctorCheck} */
export const migrationsCheck = {
  id: 'migrations',
  label: 'Migrations',
  /** @param {DatabaseContext} ctx */
  async run({ results, pendingMigrations = pendingMigrationsError }) {
    if (results.get('database')?.status !== 'ok') {
      return skip('database not reachable');
    }
    const err = await pendingMigrations();
    return err ? fail(err) : ok('all applied');
  },
};

/**
 * Boot only warns here (a few decks fail, the install works); the doctor is
 * red, so a deploy that gates on it does not ship past a skipped cutover.
 * @type {import('./finding.js').DoctorCheck}
 */
export const themeReferencesCheck = {
  id: 'theme-references',
  label: 'Theme references',
  /** @param {DatabaseContext} ctx */
  async run({
    results,
    unmigratedThemeReferences = unmigratedThemeReferencesError,
  }) {
    if (results.get('migrations')?.status !== 'ok') {
      return skip('schema not current');
    }
    const err = await unmigratedThemeReferences();
    return err ? fail(err) : ok('every deck and library slide names a record');
  },
};
