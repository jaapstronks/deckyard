/**
 * Migration: Image Library Enhancements
 * - Adds uploaded_by column to track who uploaded each image
 * - Creates favorites table for user-specific favorites
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Track who uploaded each image
  await sql`
    ALTER TABLE image_library
    ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(320)
  `.execute(db);

  // Index for filtering by uploader
  await sql`
    CREATE INDEX IF NOT EXISTS idx_image_library_uploaded_by
    ON image_library(organization_id, uploaded_by)
  `.execute(db);

  // Favorites: separate table for user-specific favorites
  await sql`
    CREATE TABLE IF NOT EXISTS image_library_favorites (
      image_id UUID NOT NULL REFERENCES image_library(id) ON DELETE CASCADE,
      user_email VARCHAR(320) NOT NULL,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (image_id, user_email, organization_id)
    )
  `.execute(db);

  // Index for fetching user's favorites
  await sql`
    CREATE INDEX IF NOT EXISTS idx_image_library_favorites_user
    ON image_library_favorites(organization_id, user_email)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP TABLE IF EXISTS image_library_favorites`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_image_library_uploaded_by`.execute(db);
  await sql`ALTER TABLE image_library DROP COLUMN IF EXISTS uploaded_by`.execute(db);
};
