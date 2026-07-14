/**
 * Migration for AI-powered suggestions:
 * - Add comment_type column to distinguish AI suggestions from human comments
 * - Add suggestion_category for filtering by suggestion type
 * - Add proposed_slide column for actionable suggestions with slide JSON
 */

export const up = async (db) => {
  // Add comment_type column (human vs ai-suggestion)
  await db.schema
    .alterTable('presentation_comments')
    .addColumn('comment_type', 'varchar(20)', (col) => col.defaultTo('human'))
    .execute();

  // Add suggestion_category column for filtering
  await db.schema
    .alterTable('presentation_comments')
    .addColumn('suggestion_category', 'varchar(30)')
    .execute();

  // Add proposed_slide column for actionable suggestions (JSONB)
  await db.schema
    .alterTable('presentation_comments')
    .addColumn('proposed_slide', 'jsonb')
    .execute();

  // Create indexes for efficient querying
  await db.schema
    .createIndex('idx_comments_type')
    .on('presentation_comments')
    .column('comment_type')
    .execute();

  await db.schema
    .createIndex('idx_comments_category')
    .on('presentation_comments')
    .column('suggestion_category')
    .execute();
};

export const down = async (db) => {
  // Drop indexes first
  await db.schema.dropIndex('idx_comments_category').execute();
  await db.schema.dropIndex('idx_comments_type').execute();

  // Drop columns
  await db.schema
    .alterTable('presentation_comments')
    .dropColumn('proposed_slide')
    .execute();

  await db.schema
    .alterTable('presentation_comments')
    .dropColumn('suggestion_category')
    .execute();

  await db.schema
    .alterTable('presentation_comments')
    .dropColumn('comment_type')
    .execute();
};