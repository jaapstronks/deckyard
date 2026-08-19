/**
 * Migration: drop the host-routing and billing columns from organizations.
 *
 * Migration 032 added `subdomain` and `custom_domain` (both UNIQUE, both
 * indexed) for resolving an organization from the request hostname, plus
 * `billing_email`. None of the three was ever read: the hostname resolution
 * was never wired up, and billing lives outside this codebase.
 *
 * Both are now settled decisions rather than pending work, which is why the
 * columns go rather than wait:
 *
 *   - Host-based resolution is rejected as a model. A hostname identifies an
 *     *instance*; an organization is a dimension *within* an instance. An
 *     instance on its own hostname is deploy configuration (DNS, reverse
 *     proxy, `BASE_URL`) and needs no column here. Organizations sharing one
 *     instance switch through the session, which re-verifies membership per
 *     request.
 *   - Billing belongs to the portal that sells the instance, not to Deckyard.
 *
 * `organizations.slug` remains the stable human-readable identifier.
 *
 * Data loss is limited to what migration 032 itself wrote: `subdomain =
 * 'default'` on the default organization. Nothing read these columns, no UI
 * exposed them, and the write paths went out with this change.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Indexes are dropped explicitly: 032 created them with raw SQL rather than
  // as column constraints, so they are not removed along with the columns.
  await sql`DROP INDEX IF EXISTS idx_organizations_subdomain`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_organizations_custom_domain`.execute(db);

  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS subdomain`.execute(
    db,
  );
  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS custom_domain`.execute(
    db,
  );
  await sql`ALTER TABLE organizations DROP COLUMN IF EXISTS billing_email`.execute(
    db,
  );
};

export const down = async (db) => {
  // Restores the shape 032 created, so a rollback lands on a schema the older
  // code can run against. The values are not restored; nothing read them.
  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS subdomain VARCHAR(63) UNIQUE
  `.execute(db);

  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS custom_domain VARCHAR(255) UNIQUE
  `.execute(db);

  await sql`
    ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS billing_email VARCHAR(320)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_organizations_subdomain
    ON organizations(subdomain) WHERE subdomain IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_organizations_custom_domain
    ON organizations(custom_domain) WHERE custom_domain IS NOT NULL
  `.execute(db);
};
