/**
 * B289 (D126): an uploaded font family names the font as a desktop app knows
 * it. The family's `name` is the CSS alias the uploader chose ("GT America
 * Extended"); PowerPoint and Keynote match a run's typeface against the
 * installed font's full name (name ID 4, "GT America LCG Ext Md"), which only
 * the uploader can know. The PPTX export writes this name instead of the alias
 * (docs/reference/font-management.md § Desktop name).
 */
export const up = async (db) => {
  await db.schema
    .alterTable('font_families')
    .addColumn('desktop_family', 'varchar(255)')
    .execute();
};

export const down = async (db) => {
  await db.schema
    .alterTable('font_families')
    .dropColumn('desktop_family')
    .execute();
};
