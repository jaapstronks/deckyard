/**
 * Migration: Designer Capability
 * Adds is_designer flag to user_organizations for orthogonal designer capability.
 * Adds admins_are_designers setting to organizations.settings JSONB.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Add is_designer boolean to user_organizations
  await sql`
    ALTER TABLE user_organizations
    ADD COLUMN IF NOT EXISTS is_designer BOOLEAN NOT NULL DEFAULT false
  `.execute(db);

  // Add settings JSONB column to organizations if not exists
  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb
  `.execute(db);

  // Set owners as designers by default
  await sql`
    UPDATE user_organizations
    SET is_designer = true
    WHERE role = 'owner'
  `.execute(db);
};

export const down = async (db) => {
  await sql`
    ALTER TABLE user_organizations
    DROP COLUMN IF EXISTS is_designer
  `.execute(db);

  await sql`
    ALTER TABLE organizations
    DROP COLUMN IF EXISTS settings
  `.execute(db);
};
