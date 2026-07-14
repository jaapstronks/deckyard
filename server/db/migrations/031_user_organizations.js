/**
 * Migration: User Organizations (Multi-Workspace Support)
 * Creates the join table for user ↔ organization membership with workspace-level roles.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // User Organizations - join table for multi-workspace membership
  await db.schema
    .createTable('user_organizations')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade').notNull()
    )
    .addColumn('role', 'varchar(20)', (col) =>
      col.notNull().defaultTo('member')
    )
    .addColumn('invited_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('invited_at', 'timestamptz')
    .addColumn('joined_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Add constraint for valid roles
  await sql`
    ALTER TABLE user_organizations
    ADD CONSTRAINT user_organizations_role_check
    CHECK (role IN ('owner', 'admin', 'member'))
  `.execute(db);

  // Add unique constraint - user can only have one membership per organization
  await sql`
    ALTER TABLE user_organizations
    ADD CONSTRAINT user_organizations_unique_membership
    UNIQUE (user_id, organization_id)
  `.execute(db);

  // Indexes for efficient lookups
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_organizations_user_id
    ON user_organizations(user_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_organizations_organization_id
    ON user_organizations(organization_id)
  `.execute(db);

  // Index for finding owners of organizations
  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_organizations_org_owner
    ON user_organizations(organization_id) WHERE role = 'owner'
  `.execute(db);

  // Migrate existing users to user_organizations table
  // Each user becomes a member of their current organization
  // (The organization_id on users table determines their primary org)
  await sql`
    INSERT INTO user_organizations (user_id, organization_id, role, joined_at)
    SELECT id, organization_id,
           CASE WHEN role = 'admin' THEN 'admin' ELSE 'member' END,
           created_at
    FROM users
    WHERE organization_id IS NOT NULL
    ON CONFLICT (user_id, organization_id) DO NOTHING
  `.execute(db);

  // Make the first admin in the default org an owner
  await sql`
    UPDATE user_organizations uo
    SET role = 'owner', updated_at = now()
    FROM (
      SELECT uo2.id
      FROM user_organizations uo2
      JOIN users u ON uo2.user_id = u.id
      WHERE uo2.organization_id = '00000000-0000-0000-0000-000000000001'
        AND u.role = 'admin'
      ORDER BY u.created_at ASC
      LIMIT 1
    ) first_admin
    WHERE uo.id = first_admin.id
      AND uo.role != 'owner'
  `.execute(db);
};

export const down = async (db) => {
  await db.schema.dropTable('user_organizations').ifExists().execute();
};
