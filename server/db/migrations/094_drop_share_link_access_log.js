/**
 * The share-link verification log goes away (B784).
 *
 * Every successful `POST /api/share/:token/verify` wrote the visitor's IP and
 * raw user-agent to `share_link_access_log` (created in 004_share_links.js),
 * outside the analytics switch, with no cleanup. Its only reader was
 * `GET /api/presentations/:id/share-links/:linkId/access-log`, which nothing
 * called: not the client, not `/api/v1`, not MCP, not a known fork. The link
 * already counts its own use (`use_count`, `last_used_at`), and analytics is
 * the one "who watched" record with a real contract. The write and the route
 * are gone; this migration drops the table and the rows in it.
 *
 * Irreversible for the data: `down` recreates the empty table in its 004
 * shape so an older build can start again, but the dropped rows do not come
 * back. Both directions are idempotent.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  await db.schema.dropIndex('idx_access_log_link').ifExists().execute();
  await db.schema.dropTable('share_link_access_log').ifExists().execute();
};

export const down = async (db) => {
  await db.schema
    .createTable('share_link_access_log')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('share_link_id', 'uuid', (col) =>
      col.references('presentation_share_links.id').onDelete('cascade'),
    )
    .addColumn('accessed_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('ip_address', 'varchar(45)')
    .addColumn('user_agent', 'text')
    .execute();

  await db.schema
    .createIndex('idx_access_log_link')
    .ifNotExists()
    .on('share_link_access_log')
    .column('share_link_id')
    .execute();
};
