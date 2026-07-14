/**
 * Migration: Font Management
 * Adds font_families and font_variants tables for custom font management.
 * Supports uploaded fonts, Adobe Fonts (Typekit), fonts.com (Monotype), and Google Fonts.
 */

import { sql } from 'kysely';

export const up = async (db) => {
  // Create font_families table
  await sql`
    CREATE TABLE IF NOT EXISTS font_families (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(80) NOT NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'upload',
      category VARCHAR(40) NOT NULL DEFAULT 'sans-serif',
      source_config JSONB DEFAULT '{}',
      css_fallback VARCHAR(255),
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(organization_id, slug)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_font_families_org
    ON font_families(organization_id)
  `.execute(db);

  // Create font_variants table
  await sql`
    CREATE TABLE IF NOT EXISTS font_variants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      font_family_id UUID NOT NULL REFERENCES font_families(id) ON DELETE CASCADE,
      weight INT DEFAULT 400,
      style VARCHAR(20) DEFAULT 'normal',
      filename VARCHAR(512),
      url VARCHAR(2048),
      file_size INT,
      format VARCHAR(20) DEFAULT 'woff2',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(font_family_id, weight, style)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_font_variants_family
    ON font_variants(font_family_id)
  `.execute(db);
};

export const down = async (db) => {
  await sql`DROP INDEX IF EXISTS idx_font_variants_family`.execute(db);
  await sql`DROP TABLE IF EXISTS font_variants`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_font_families_org`.execute(db);
  await sql`DROP TABLE IF EXISTS font_families`.execute(db);
};
