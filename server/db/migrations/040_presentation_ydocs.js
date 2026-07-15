/**
 * Collab Y.Doc state (real-time collaboration, phase 2).
 *
 * One row per collaboratively-opened presentation holding the merged yjs
 * update (Yjs GC on, no append log — the versions system keeps history).
 * The deck JSON in `presentations` remains the durable format; this table
 * is a cache of the live CRDT state and may be truncated safely (docs
 * re-bootstrap from JSON on the next collab open). See ADR 001 §5.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema
    .createTable('presentation_ydocs')
    .ifNotExists()
    .addColumn('presentation_id', 'uuid', (col) =>
      col.primaryKey().references('presentations.id').onDelete('cascade')
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('state', 'bytea', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();
};

export const down = async (db) => {
  await db.schema.dropTable('presentation_ydocs').ifExists().execute();
};
