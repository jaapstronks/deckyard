/**
 * Structured mentions on comments (phase 3 of the comments & notifications
 * plan).
 *
 * The body carries the markup (`@[Name](user:email)`); this column stores
 * the parsed list `[{name, email}]`, filled server-side at create/update so
 * every write path (app, public API v1, MCP) yields the same data. NULL for
 * comments created before this migration (read as an empty list).
 */

export const up = async (db) => {
  await db.schema
    .alterTable('presentation_comments')
    .addColumn('mentions', 'jsonb')
    .execute();
};

export const down = async (db) => {
  await db.schema
    .alterTable('presentation_comments')
    .dropColumn('mentions')
    .execute();
};
