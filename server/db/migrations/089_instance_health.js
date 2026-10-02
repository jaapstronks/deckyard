/**
 * B514 (A7.3, D246): the instance-health counters. One row per sighting of a
 * key on an axis per day — which slide types are authored and viewed, which
 * surfaces, export formats, audience interactions, MCP tools and v1
 * operations this install actually uses. `count` is the raw tally; the
 * pruning measure is the number of days a key was seen, which autosave and
 * refreshes cannot inflate.
 *
 * No `organization_id`: this is instance telemetry, like `api_usage_daily`,
 * and it holds no person, deck or organization. `server/storage/
 * instance-health.js` is the only writer (docs/reference/instance-health.md).
 */
export const up = async (db) => {
  await db.schema
    .createTable('instance_health')
    .addColumn('axis', 'varchar(32)', (col) => col.notNull())
    .addColumn('key', 'varchar(128)', (col) => col.notNull())
    .addColumn('day', 'date', (col) => col.notNull())
    .addColumn('count', 'integer', (col) => col.notNull().defaultTo(0))
    .addPrimaryKeyConstraint('instance_health_pkey', ['axis', 'key', 'day'])
    .execute();

  // The read (a window of days) and the prune (everything before a day) both
  // filter on `day` alone; the primary key leads with `axis`.
  await db.schema
    .createIndex('idx_instance_health_day')
    .on('instance_health')
    .column('day')
    .execute();
};

export const down = async (db) => {
  await db.schema.dropIndex('idx_instance_health_day').ifExists().execute();
  await db.schema.dropTable('instance_health').ifExists().execute();
};
