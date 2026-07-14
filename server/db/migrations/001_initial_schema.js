/**
 * Initial schema migration for Deckyard.
 * Creates all core tables with multi-tenancy support.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Organizations (multi-tenancy foundation)
  await db.schema
    .createTable('organizations')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('slug', 'varchar(100)', (col) => col.unique().notNull())
    .addColumn('settings', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Users
  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('email', 'varchar(320)', (col) => col.unique().notNull())
    .addColumn('name', 'varchar(255)')
    .addColumn('role', 'varchar(20)', (col) => col.defaultTo('user'))
    .addColumn('settings', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Presentations
  await db.schema
    .createTable('presentations')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('owner_email', 'varchar(320)')
    .addColumn('created_by', 'varchar(320)')
    .addColumn('updated_by', 'varchar(320)')
    .addColumn('title', 'varchar(500)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('theme', 'varchar(80)', (col) => col.defaultTo('default'))
    .addColumn('lang', 'varchar(10)', (col) => col.defaultTo('nl'))
    .addColumn('scope', 'varchar(20)', (col) => col.defaultTo('private'))
    .addColumn('revision', 'integer', (col) => col.defaultTo(1))
    .addColumn('settings', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('i18n', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('slides', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    .addColumn('notion_source_page_id', 'varchar(100)')
    .addColumn('sandbox', 'jsonb')
    .addColumn('published', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('modified_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Presentation Versions
  await db.schema
    .createTable('presentation_versions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade')
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('created_by', 'varchar(320)')
    .addColumn('reason', 'varchar(50)', (col) => col.defaultTo('snapshot'))
    .addColumn('label', 'varchar(255)')
    .addColumn('revision', 'integer')
    .addColumn('title', 'varchar(500)')
    .addColumn('presentation_data', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Published Presentations
  await db.schema
    .createTable('published_presentations')
    .ifNotExists()
    .addColumn('id', 'varchar(20)', (col) => col.primaryKey())
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('cascade')
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('title', 'varchar(500)')
    .addColumn('slug', 'varchar(255)')
    .addColumn('og_image_url', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('modified_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Image Library - use raw SQL for array columns
  await sql`
    CREATE TABLE IF NOT EXISTS image_library (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title VARCHAR(255),
      description VARCHAR(200),
      photographer VARCHAR(120),
      tags TEXT[] DEFAULT '{}',
      alts JSONB DEFAULT '{"nl": "", "en-GB": ""}'::jsonb,
      sources TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `.execute(db);

  // Slide Library - use raw SQL for array columns
  await sql`
    CREATE TABLE IF NOT EXISTS slide_library (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      owner_email VARCHAR(320),
      scope VARCHAR(20) NOT NULL,
      name VARCHAR(120) NOT NULL,
      slide_type VARCHAR(80) NOT NULL,
      theme_id VARCHAR(80),
      content JSONB NOT NULL DEFAULT '{}'::jsonb,
      favorites TEXT[] DEFAULT '{}',
      trashed_at TIMESTAMPTZ,
      trashed_by VARCHAR(320),
      created_by VARCHAR(320),
      updated_by VARCHAR(320),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `.execute(db);

  // Follow Codes
  await db.schema
    .createTable('follow_codes')
    .ifNotExists()
    .addColumn('code', 'char(4)', (col) => col.primaryKey())
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('follow_url', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute();

  // App Settings - use raw SQL for array columns
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      supported_slide_langs TEXT[] DEFAULT '{"nl", "en-GB"}',
      webhooks JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `.execute(db);

  // Present Sessions (live presentations)
  await db.schema
    .createTable('present_sessions')
    .ifNotExists()
    .addColumn('session_id', 'varchar(100)', (col) => col.primaryKey())
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('presentation_id', 'uuid', (col) =>
      col.references('presentations.id').onDelete('set null')
    )
    .addColumn('state', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('control_enabled', 'boolean', (col) => col.defaultTo(false))
    .addColumn('follow_codes', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('last_activity_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Interactions (polls, likert)
  await db.schema
    .createTable('interactions')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'varchar(100)', (col) =>
      col.references('present_sessions.session_id').onDelete('cascade')
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('slide_id', 'uuid', (col) => col.notNull())
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    .addColumn('status', 'varchar(10)', (col) => col.defaultTo('open'))
    .addColumn('option_count', 'integer', (col) => col.defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Interaction Votes
  await db.schema
    .createTable('interaction_votes')
    .ifNotExists()
    .addColumn('interaction_id', 'uuid', (col) =>
      col.references('interactions.id').onDelete('cascade')
    )
    .addColumn('device_id', 'varchar(100)', (col) => col.notNull())
    .addColumn('option_index', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Add primary key constraint for interaction_votes
  await sql`
    ALTER TABLE interaction_votes
    ADD CONSTRAINT interaction_votes_pkey PRIMARY KEY (interaction_id, device_id)
  `.execute(db);

  // Questions (Q&A) - use raw SQL for array columns
  await sql`
    CREATE TABLE IF NOT EXISTS questions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id VARCHAR(100) REFERENCES present_sessions(session_id) ON DELETE CASCADE,
      organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
      author_id VARCHAR(100) NOT NULL,
      author_name VARCHAR(60),
      text TEXT NOT NULL,
      original_text TEXT,
      original_lang VARCHAR(10),
      texts JSONB DEFAULT '{}'::jsonb,
      upvotes INTEGER DEFAULT 0,
      voters TEXT[] DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'active',
      promoted_at TIMESTAMPTZ,
      promoted_slide_id UUID,
      promoted_by VARCHAR(320),
      removed_at TIMESTAMPTZ,
      removed_by VARCHAR(320),
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `.execute(db);

  // Feedback
  await db.schema
    .createTable('feedback')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'varchar(100)', (col) =>
      col.references('present_sessions.session_id').onDelete('cascade')
    )
    .addColumn('organization_id', 'uuid', (col) =>
      col.references('organizations.id').onDelete('cascade')
    )
    .addColumn('slide_id', 'uuid', (col) => col.notNull())
    .addColumn('device_id', 'varchar(100)', (col) => col.notNull())
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`))
    .execute();

  // Add unique constraint for feedback
  await sql`
    ALTER TABLE feedback
    ADD CONSTRAINT feedback_session_slide_device_unique
    UNIQUE (session_id, slide_id, device_id)
  `.execute(db);

  // Add unique constraint for interactions
  await sql`
    ALTER TABLE interactions
    ADD CONSTRAINT interactions_session_slide_unique
    UNIQUE (session_id, slide_id)
  `.execute(db);

  // Create default organization for single-tenant mode
  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES ('00000000-0000-0000-0000-000000000001', 'Default', 'default')
    ON CONFLICT (id) DO NOTHING
  `.execute(db);
};

export const down = async (db) => {
  // Drop tables in reverse order of creation (respecting foreign keys)
  await db.schema.dropTable('feedback').ifExists().execute();
  await db.schema.dropTable('questions').ifExists().execute();
  await db.schema.dropTable('interaction_votes').ifExists().execute();
  await db.schema.dropTable('interactions').ifExists().execute();
  await db.schema.dropTable('present_sessions').ifExists().execute();
  await db.schema.dropTable('app_settings').ifExists().execute();
  await db.schema.dropTable('follow_codes').ifExists().execute();
  await db.schema.dropTable('slide_library').ifExists().execute();
  await db.schema.dropTable('image_library').ifExists().execute();
  await db.schema.dropTable('published_presentations').ifExists().execute();
  await db.schema.dropTable('presentation_versions').ifExists().execute();
  await db.schema.dropTable('presentations').ifExists().execute();
  await db.schema.dropTable('users').ifExists().execute();
  await db.schema.dropTable('organizations').ifExists().execute();
};