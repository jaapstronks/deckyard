/** Validate all installed theme seeds before changing any database row. */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'kysely';
import { repoRoot } from '../config/paths.js';
import { customDirFor } from '../../shared/custom-root.js';
import { getDb } from '../db/client.js';
import { curatedFontFaces, isValidFont } from '../../shared/theme-fonts.js';
import {
  checkThemeConfig,
  validateThemeColors,
} from '../../shared/theme-config-schema.js';
import { isValidSlug } from '../storage/utils/index.js';

const RECORD_FIELDS = [
  'slug',
  'label',
  'logoUrl',
  'logoSmallUrl',
  'colors',
  'fonts',
  'config',
];
const FONT_FIELDS = ['heading', 'body'];

function refuse(file, field) {
  throw new Error(`Theme seed ${file}: invalid ${field}`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key])]),
    );
  return value;
}

/** Return the portable record after strict field and value checks. */
export function validateThemeSeed(record, file) {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    refuse(file, 'record');
  for (const key of Object.keys(record))
    if (!RECORD_FIELDS.includes(key)) refuse(file, key);
  if (!isValidSlug(record.slug) || record.slug !== path.basename(file, '.json'))
    refuse(file, 'slug');
  if (
    typeof record.label !== 'string' ||
    !record.label.trim() ||
    record.label.length > 255
  )
    refuse(file, 'label');
  for (const key of ['logoUrl', 'logoSmallUrl']) {
    const value = record[key];
    if (
      value != null &&
      (typeof value !== 'string' || !/^\/(assets|custom\/assets)\//.test(value))
    )
      refuse(file, key);
  }
  const colors = validateThemeColors(record.colors);
  if (
    !record.colors ||
    typeof record.colors !== 'object' ||
    Array.isArray(record.colors)
  )
    refuse(file, 'colors');
  if (!colors.ok) refuse(file, colors.path || 'colors');
  if (
    !record.fonts ||
    typeof record.fonts !== 'object' ||
    Array.isArray(record.fonts)
  )
    refuse(file, 'fonts');
  for (const key of Object.keys(record.fonts))
    if (!FONT_FIELDS.includes(key)) refuse(file, `fonts.${key}`);
  for (const key of FONT_FIELDS)
    if (!isValidFont(record.fonts[key])) refuse(file, `fonts.${key}`);
  if (
    !record.config ||
    typeof record.config !== 'object' ||
    Array.isArray(record.config)
  )
    refuse(file, 'config');
  const config = checkThemeConfig(record.config);
  if (!config.ok) refuse(file, config.path || 'config');
  return record;
}

/** Load core and optional fork seeds; reject a duplicate before any upsert. */
export async function readThemeSeeds(root = repoRoot) {
  // Until B438.2 removes the old file runtime, records live below themes/seeds.
  const dirs = [
    path.join(root, 'themes', 'seeds'),
    path.join(customDirFor(root), 'themes'),
  ];
  const seen = new Map();
  const seeds = [];
  for (const [index, dir] of dirs.entries()) {
    let files;
    try {
      files = (await fs.readdir(dir))
        .filter((name) => name.endsWith('.json'))
        .sort();
    } catch (error) {
      if (error.code === 'ENOENT' && index === 1) continue;
      throw error;
    }
    if (index === 0 && files.length !== 6)
      throw new Error(
        `Expected six core theme seeds in ${dir}, found ${files.length}`,
      );
    for (const name of files) {
      const file = path.join(dir, name);
      const record = validateThemeSeed(
        JSON.parse(await fs.readFile(file, 'utf8')),
        file,
      );
      for (const role of FONT_FIELDS) {
        for (const face of curatedFontFaces(record.fonts[role])) {
          try {
            await fs.access(path.join(repoRoot, face.path));
          } catch {
            refuse(file, `fonts.${role} (${face.path} missing)`);
          }
        }
      }
      const previous = seen.get(record.slug);
      if (previous)
        throw new Error(
          `Theme seed slug ${record.slug} appears in ${previous} and ${file}`,
        );
      seen.set(record.slug, file);
      seeds.push({
        record,
        hash: createHash('sha256')
          .update(JSON.stringify(canonicalJson(record)))
          .digest('hex'),
      });
    }
  }
  return seeds;
}

/** Refresh all seeds in one transaction, preserving IDs and skipping unchanged rows. */
export async function initializeThemeSeeds() {
  const seeds = await readThemeSeeds();
  await upsertThemeSeeds(getDb(), seeds);
}

/** Apply a fully validated seed batch in one transaction. */
export async function upsertThemeSeeds(db, seeds) {
  await db.transaction().execute(async (trx) => {
    for (const { record, hash } of seeds) {
      await sql`
        INSERT INTO themes (organization_id, seed_hash, slug, label, logo_url, logo_small_url, colors, fonts, config)
        VALUES (NULL, ${hash}, ${record.slug}, ${record.label}, ${record.logoUrl ?? null}, ${record.logoSmallUrl ?? null},
          ${JSON.stringify(record.colors)}::jsonb, ${JSON.stringify(record.fonts)}::jsonb, ${JSON.stringify(record.config)}::jsonb)
        ON CONFLICT (slug) WHERE organization_id IS NULL DO UPDATE SET
          seed_hash = EXCLUDED.seed_hash, label = EXCLUDED.label,
          logo_url = EXCLUDED.logo_url, logo_small_url = EXCLUDED.logo_small_url,
          colors = EXCLUDED.colors, fonts = EXCLUDED.fonts, config = EXCLUDED.config, updated_at = now()
        WHERE themes.seed_hash IS DISTINCT FROM EXCLUDED.seed_hash
      `.execute(trx);
    }
  });
}
