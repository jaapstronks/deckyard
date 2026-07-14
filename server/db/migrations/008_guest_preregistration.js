/**
 * Migration for guest pre-registration:
 * - Add registration_mode to presentation_share_links (open vs invite_only)
 * - Add invitation tracking fields to share_link_guests
 */

export const up = async (db) => {
  // Add registration_mode to presentation_share_links
  await db.schema
    .alterTable('presentation_share_links')
    .addColumn('registration_mode', 'varchar(20)', (col) =>
      col.defaultTo('invite_only').notNull()
    )
    .execute();

  // Add invitation fields to share_link_guests
  await db.schema
    .alterTable('share_link_guests')
    .addColumn('invited_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('share_link_guests')
    .addColumn('invited_by', 'varchar(320)')
    .execute();

  await db.schema
    .alterTable('share_link_guests')
    .addColumn('invitation_sent_at', 'timestamptz')
    .execute();
};

export const down = async (db) => {
  // Remove invitation fields from share_link_guests
  await db.schema
    .alterTable('share_link_guests')
    .dropColumn('invitation_sent_at')
    .execute();

  await db.schema
    .alterTable('share_link_guests')
    .dropColumn('invited_by')
    .execute();

  await db.schema
    .alterTable('share_link_guests')
    .dropColumn('invited_at')
    .execute();

  // Remove registration_mode from presentation_share_links
  await db.schema
    .alterTable('presentation_share_links')
    .dropColumn('registration_mode')
    .execute();
};