/**
 * Migration for workspace view-only sharing:
 * - Adds is_view_only boolean to presentations.
 *
 * The flag was previously only persisted by the file adapter (which stores the
 * whole presentation JSON blob). The Postgres adapter maps a fixed column set,
 * so is_view_only was silently dropped on write and never returned on read.
 * That made the workspace access pills default back to "View & comment" after a
 * reload of a deck actually shared with "Full access". This column lets the
 * Postgres path round-trip the flag like every other adapter.
 */

export const up = async (db) => {
  await db.schema
    .alterTable('presentations')
    .addColumn('is_view_only', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();
};

export const down = async (db) => {
  await db.schema
    .alterTable('presentations')
    .dropColumn('is_view_only')
    .execute();
};
