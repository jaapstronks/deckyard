/**
 * Migration: Add small logo URL to themes table.
 * Allows themes to have a separate smaller logo for title slides.
 */

export const up = async (db) => {
  await db.schema
    .alterTable('themes')
    .addColumn('logo_small_url', 'text')
    .execute();
};

export const down = async (db) => {
  await db.schema
    .alterTable('themes')
    .dropColumn('logo_small_url')
    .execute();
};
