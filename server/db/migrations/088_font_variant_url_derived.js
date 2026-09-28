/**
 * B510: an uploaded font variant is a private media object, and its served URL
 * (`/fonts/managed/<file>`) derives from the storage key in `filename`. The
 * stored `url` was a second address for the same object — the public bucket
 * URL this change retires — so the column goes.
 *
 * Variants uploaded before this migration keep a public key in `filename` and
 * have no URL until `scripts/privatize-font-variants.js --apply` moves their
 * file into private storage (docs/reference/font-management.md § Private font
 * variants).
 */
export const up = async (db) => {
  await db.schema.alterTable('font_variants').dropColumn('url').execute();
};

export const down = async (db) => {
  await db.schema
    .alterTable('font_variants')
    .addColumn('url', 'varchar(2048)')
    .execute();
};
