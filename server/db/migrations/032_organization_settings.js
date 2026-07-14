/**
 * Migration: Organization Settings
 * Adds subdomain and workspace-related settings to organizations table.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Add subdomain column (for subdomain-based routing)
  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS subdomain VARCHAR(63) UNIQUE
  `.execute(db);

  // Add custom domain column (for custom domain support)
  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255) UNIQUE
  `.execute(db);

  // Add billing email column (primary contact for billing)
  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS billing_email VARCHAR(320)
  `.execute(db);

  // Add logo URL column (workspace branding)
  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS logo_url TEXT
  `.execute(db);

  // Add display name (can be different from internal name)
  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)
  `.execute(db);

  // Add description column (workspace description)
  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS description TEXT
  `.execute(db);

  // Index for subdomain lookups (used in subdomain routing middleware)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_organizations_subdomain
    ON organizations(subdomain) WHERE subdomain IS NOT NULL
  `.execute(db);

  // Index for custom domain lookups
  await sql`
    CREATE INDEX IF NOT EXISTS idx_organizations_custom_domain
    ON organizations(custom_domain) WHERE custom_domain IS NOT NULL
  `.execute(db);

  // Set default subdomain for the default organization
  await sql`
    UPDATE organizations
    SET subdomain = 'default'
    WHERE id = '00000000-0000-0000-0000-000000000001'
      AND subdomain IS NULL
  `.execute(db);
};

export const down = async (db) => {
  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS subdomain`.execute(db);
  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS custom_domain`.execute(db);
  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS billing_email`.execute(db);
  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS logo_url`.execute(db);
  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS display_name`.execute(db);
  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS description`.execute(db);
};
