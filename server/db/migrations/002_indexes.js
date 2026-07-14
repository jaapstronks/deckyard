/**
 * Create indexes for performance optimization.
 */

export const up = async (db) => {
  // Presentations indexes
  await db.schema
    .createIndex('idx_presentations_org_id')
    .on('presentations')
    .column('organization_id')
    .execute();

  await db.schema
    .createIndex('idx_presentations_owner')
    .on('presentations')
    .column('owner_email')
    .execute();

  await db.schema
    .createIndex('idx_presentations_modified')
    .on('presentations')
    .column('modified_at desc')
    .execute();

  await db.schema
    .createIndex('idx_presentations_scope')
    .on('presentations')
    .columns(['organization_id', 'scope'])
    .execute();

  // Users index
  await db.schema
    .createIndex('idx_users_org_id')
    .on('users')
    .column('organization_id')
    .execute();

  // Presentation versions indexes
  await db.schema
    .createIndex('idx_presentation_versions_pres_id')
    .on('presentation_versions')
    .column('presentation_id')
    .execute();

  await db.schema
    .createIndex('idx_presentation_versions_created')
    .on('presentation_versions')
    .column('created_at desc')
    .execute();

  // Image library indexes
  await db.schema
    .createIndex('idx_image_library_org')
    .on('image_library')
    .column('organization_id')
    .execute();

  // Slide library indexes
  await db.schema
    .createIndex('idx_slide_library_org_scope')
    .on('slide_library')
    .columns(['organization_id', 'scope'])
    .execute();

  // Follow codes index
  await db.schema
    .createIndex('idx_follow_codes_expires')
    .on('follow_codes')
    .column('expires_at')
    .execute();

  // Present sessions indexes
  await db.schema
    .createIndex('idx_present_sessions_org')
    .on('present_sessions')
    .column('organization_id')
    .execute();

  await db.schema
    .createIndex('idx_present_sessions_pres')
    .on('present_sessions')
    .column('presentation_id')
    .execute();

  await db.schema
    .createIndex('idx_present_sessions_activity')
    .on('present_sessions')
    .column('last_activity_at')
    .execute();

  // Interactions indexes
  await db.schema
    .createIndex('idx_interactions_session')
    .on('interactions')
    .column('session_id')
    .execute();

  // Questions indexes
  await db.schema
    .createIndex('idx_questions_session')
    .on('questions')
    .column('session_id')
    .execute();

  // Feedback indexes
  await db.schema
    .createIndex('idx_feedback_session')
    .on('feedback')
    .column('session_id')
    .execute();
};

export const down = async (db) => {
  // Drop indexes in reverse order
  await db.schema.dropIndex('idx_feedback_session').ifExists().execute();
  await db.schema.dropIndex('idx_questions_session').ifExists().execute();
  await db.schema.dropIndex('idx_interactions_session').ifExists().execute();
  await db.schema.dropIndex('idx_present_sessions_activity').ifExists().execute();
  await db.schema.dropIndex('idx_present_sessions_pres').ifExists().execute();
  await db.schema.dropIndex('idx_present_sessions_org').ifExists().execute();
  await db.schema.dropIndex('idx_follow_codes_expires').ifExists().execute();
  await db.schema.dropIndex('idx_slide_library_org_scope').ifExists().execute();
  await db.schema.dropIndex('idx_image_library_org').ifExists().execute();
  await db.schema.dropIndex('idx_presentation_versions_created').ifExists().execute();
  await db.schema.dropIndex('idx_presentation_versions_pres_id').ifExists().execute();
  await db.schema.dropIndex('idx_users_org_id').ifExists().execute();
  await db.schema.dropIndex('idx_presentations_scope').ifExists().execute();
  await db.schema.dropIndex('idx_presentations_modified').ifExists().execute();
  await db.schema.dropIndex('idx_presentations_owner').ifExists().execute();
  await db.schema.dropIndex('idx_presentations_org_id').ifExists().execute();
};