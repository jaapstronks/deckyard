/** Validate all installed theme seeds before changing any database row. */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../config/paths.js';
import { customDirFor } from '../../shared/custom-root.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { upsertThemeSeeds } from '../storage/themes.js';
import { curatedFontFaces, isValidFont } from '../../shared/theme-fonts.js';
import {
  checkThemeConfig,
  validateThemeColors,
} from '../../shared/theme-config-schema.js';
import { isValidSlug } from '../../shared/slug.js';

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

/** Validate one seed directory; the core directory must hold exactly six. */
async function readSeedDir(dir, { core }) {
  let files;
  try {
    files = (await fs.readdir(dir))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT' && !core) return [];
    throw error;
  }
  if (core && files.length !== 6)
    throw new Error(
      `Expected six core theme seeds in ${dir}, found ${files.length}`,
    );
  const seeds = [];
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
    seeds.push({
      file,
      record,
      hash: createHash('sha256')
        .update(JSON.stringify(canonicalJson(record)))
        .digest('hex'),
    });
  }
  return seeds;
}

const withoutFile = ({ record, hash }) => ({ record, hash });

/**
 * Load only the six core seeds under `<root>/themes/`, never the fork root.
 * Core tests read seeds through this, so a fork's own seeds cannot change them.
 */
export async function readCoreThemeSeeds(root = repoRoot) {
  return (await readSeedDir(path.join(root, 'themes'), { core: true })).map(
    withoutFile,
  );
}

/** Load core and optional fork seeds; reject a duplicate before any upsert. */
export async function readThemeSeeds(root = repoRoot) {
  const seeds = [
    ...(await readSeedDir(path.join(root, 'themes'), { core: true })),
    ...(await readSeedDir(path.join(customDirFor(root), 'themes'), {
      core: false,
    })),
  ];
  const seen = new Map();
  for (const { record, file } of seeds) {
    const previous = seen.get(record.slug);
    if (previous)
      throw new Error(
        `Theme seed slug ${record.slug} appears in ${previous} and ${file}`,
      );
    seen.set(record.slug, file);
  }
  return seeds.map(withoutFile);
}

/** Refresh all seeds in one transaction, preserving IDs and skipping unchanged rows. */
export async function initializeThemeSeeds(root = repoRoot) {
  const seeds = await readThemeSeeds(root);
  await upsertThemeSeeds(
    crossOrganizationScope(root, 'Installed theme seeds are instance-wide'),
    seeds,
  );
}
