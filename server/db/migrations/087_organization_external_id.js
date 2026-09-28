export const up = async (db) => {
  await db.schema
    .alterTable('organizations')
    .addColumn('external_id', 'varchar(255)')
    .execute();
  await db.schema
    .createIndex('organizations_external_id_unique')
    .unique()
    .on('organizations')
    .column('external_id')
    .execute();
};

export const down = async (db) => {
  await db.schema.dropIndex('organizations_external_id_unique').execute();
  await db.schema
    .alterTable('organizations')
    .dropColumn('external_id')
    .execute();
};
