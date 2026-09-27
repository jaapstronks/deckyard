/** A real committed seed record in fake-DB row form for tests that boot a deck. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildThemeConfig } from '../../server/utils/theme-builder.js';
import { normalizeTheme } from '../../shared/theme-normalize.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const ids = {
  amethyst: '00000000-0000-4000-8000-0000000000ba',
  brand: '00000000-0000-4000-8000-0000000000bb',
  corporate: '00000000-0000-4000-8000-0000000000bc',
  editorial: '00000000-0000-4000-8000-0000000000bd',
  midnight: '00000000-0000-4000-8000-0000000000be',
  playful: '00000000-0000-4000-8000-0000000000bf',
};

/** A committed seed converted to the same row shape the database serves. */
export async function seedRow(slug) {
  if (!ids[slug]) throw new Error(`Unknown test seed: ${slug}`);
  const record = JSON.parse(
    await fs.readFile(path.join(repoRoot, `themes/${slug}.json`), 'utf8'),
  );
  return {
    id: ids[slug],
    organization_id: null,
    seed_hash: 'test-fixture',
    slug: record.slug,
    label: record.label,
    logo_url: record.logoUrl ?? null,
    logo_small_url: record.logoSmallUrl ?? null,
    colors: record.colors,
    fonts: record.fonts,
    config: record.config,
    is_default: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

export async function brandSeedRow() {
  return seedRow('brand');
}

/** Resolve a committed seed through the production projection without a DB. */
export async function seedThemeConfig(slug) {
  const row = await seedRow(slug);
  return normalizeTheme(
    buildThemeConfig({
      id: row.id,
      slug: row.slug,
      label: row.label,
      logoUrl: row.logo_url,
      logoSmallUrl: row.logo_small_url,
      colors: row.colors,
      fonts: row.fonts,
      config: row.config,
    }),
  );
}
