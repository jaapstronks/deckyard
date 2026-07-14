/**
 * Migration for positioned comments:
 * - Add position_x and position_y columns to presentation_comments
 * - Allows users to pin comments at specific positions on slides
 */

export const up = async (db) => {
  // Add position columns to presentation_comments table
  await db.schema
    .alterTable('presentation_comments')
    .addColumn('position_x', 'real')
    .execute();

  await db.schema
    .alterTable('presentation_comments')
    .addColumn('position_y', 'real')
    .execute();
};

export const down = async (db) => {
  // Remove position columns from presentation_comments table
  await db.schema
    .alterTable('presentation_comments')
    .dropColumn('position_y')
    .execute();

  await db.schema
    .alterTable('presentation_comments')
    .dropColumn('position_x')
    .execute();
};