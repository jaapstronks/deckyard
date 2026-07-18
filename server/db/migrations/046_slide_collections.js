/**
 * Migration to add slide collections: a named, ordered, scoped set of
 * slide-library items (the "starter kit" primitive, composable instead of
 * clone-then-prune).
 *
 * - slide_collections: the collection entity (personal/team scope, mirroring
 *   the slide library's split).
 * - slide_collection_items: ordered membership join table referencing existing
 *   slide_library rows (no content copy). The `position` column carries order.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Collection entity
  await db.schema
    .createTable('slide_collections')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`)
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').notNull()
    )
    .addColumn('owner_email', 'varchar(320)')
    .addColumn('scope', 'varchar(20)', (col) => col.notNull())
    .addColumn('name', 'varchar(120)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('created_by', 'varchar(320)')
    .addColumn('updated_by', 'varchar(320)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Index for listing a scope's collections
  await db.schema
    .createIndex('idx_slide_collections_org_scope')
    .on('slide_collections')
    .columns(['organization_id', 'scope'])
    .execute();

  // Ordered membership join table
  await db.schema
    .createTable('slide_collection_items')
    .ifNotExists()
    .addColumn('collection_id', 'uuid', (col) =>
      col.references('slide_collections.id').onDelete('cascade').notNull()
    )
    .addColumn('slide_library_id', 'uuid', (col) =>
      col.references('slide_library.id').onDelete('cascade').notNull()
    )
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Primary key on the join table
  await sql`
    ALTER TABLE slide_collection_items
    ADD CONSTRAINT pk_slide_collection_items PRIMARY KEY (collection_id, slide_library_id)
  `.execute(db);

  // Index for reading a collection's ordered membership
  await db.schema
    .createIndex('idx_slide_collection_items_collection')
    .on('slide_collection_items')
    .columns(['collection_id', 'position'])
    .execute();
};

export const down = async (db) => {
  await db.schema
    .dropIndex('idx_slide_collection_items_collection')
    .ifExists()
    .execute();
  await db.schema.dropTable('slide_collection_items').ifExists().execute();
  await db.schema.dropIndex('idx_slide_collections_org_scope').ifExists().execute();
  await db.schema.dropTable('slide_collections').ifExists().execute();
};
