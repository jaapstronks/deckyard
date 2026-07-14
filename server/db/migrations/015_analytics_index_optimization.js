/**
 * Migration for additional analytics indexes.
 * Optimizes GDPR queries and organization-scoped operations.
 */

export const up = async (db) => {
  // Index for GDPR export/delete by viewer email (view_sessions)
  await db.schema
    .createIndex('idx_view_sessions_viewer_email')
    .on('view_sessions')
    .column('viewer_email')
    .where('viewer_email', 'is not', null)
    .execute();

  // Composite index for organization-scoped session queries
  await db.schema
    .createIndex('idx_view_sessions_org_presentation')
    .on('view_sessions')
    .columns(['organization_id', 'presentation_id', 'started_at'])
    .execute();

  // Index for IP anonymization cleanup (created_at + ip_address)
  await db.schema
    .createIndex('idx_view_sessions_cleanup')
    .on('view_sessions')
    .columns(['created_at', 'ip_address'])
    .execute();

  // Index for slide views by entered_at (for time-based queries)
  await db.schema
    .createIndex('idx_slide_views_entered')
    .on('slide_views')
    .column('entered_at')
    .execute();

  // Composite index for current slide view lookup (session + open views)
  await db.schema
    .createIndex('idx_slide_views_current')
    .on('slide_views')
    .columns(['view_session_id', 'exited_at'])
    .where('exited_at', 'is', null)
    .execute();

  // Index for analytics reports by organization
  await db.schema
    .createIndex('idx_analytics_reports_org')
    .on('analytics_reports')
    .columns(['organization_id', 'created_at'])
    .execute();
};

export const down = async (db) => {
  await db.schema.dropIndex('idx_analytics_reports_org').ifExists().execute();
  await db.schema.dropIndex('idx_slide_views_current').ifExists().execute();
  await db.schema.dropIndex('idx_slide_views_entered').ifExists().execute();
  await db.schema.dropIndex('idx_view_sessions_cleanup').ifExists().execute();
  await db.schema.dropIndex('idx_view_sessions_org_presentation').ifExists().execute();
  await db.schema.dropIndex('idx_view_sessions_viewer_email').ifExists().execute();
};