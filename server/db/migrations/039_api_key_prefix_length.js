/**
 * Fix api_keys.key_prefix column length.
 *
 * The prefix format is dk_live_ (8) + 8 random chars = 16 chars,
 * but the column was created as varchar(12). Widen to varchar(24)
 * to accommodate the actual prefix format with room to spare.
 */

export async function up(db) {
  await db.schema
    .alterTable('api_keys')
    .alterColumn('key_prefix', (col) => col.setDataType('varchar(24)'))
    .execute();
}

export async function down(db) {
  await db.schema
    .alterTable('api_keys')
    .alterColumn('key_prefix', (col) => col.setDataType('varchar(12)'))
    .execute();
}
