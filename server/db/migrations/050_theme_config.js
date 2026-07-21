/**
 * Migration: Add a `config` JSON column to the themes table.
 *
 * DB themes could only store four colours, two fonts and two logo URLs, so
 * anything richer — named slide background variants, background presets,
 * surface tokens, override locks — was expressible in a file theme but not in
 * an in-app one. `config` holds that richer shape; `server/utils/theme-builder.js`
 * merges it over the derived defaults.
 *
 * Existing rows get `{}` and must render byte-identically (pinned by
 * tests/theme-builder-config.test.js).
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema
    .alterTable('themes')
    .addColumn('config', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`)
    )
    .execute();
};

export const down = async (db) => {
  await db.schema.alterTable('themes').dropColumn('config').execute();
};
