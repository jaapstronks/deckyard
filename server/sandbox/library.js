/**
 * Sandbox library seed (B352).
 *
 * A sandbox guest has no team, so an empty organization shelf left the slide
 * library and the Building blocks on Home with nothing to show. This seeds a
 * handful of real slides from the example decks, plus one collection, onto the
 * organization shelf, so the library is the real library with real items in it
 * rather than a mockup of one.
 *
 * The seed is declared as JSON under `server/sandbox-examples/library/`: one
 * file per slide (`<key>.json`: name, description, slideType, theme slug,
 * lang, content; `lang` is the language the content is written in and becomes
 * the item's `i18n.dominant`, B603) and one per collection
 * (`collections/<key>.json`: name, description, the slide keys in order). The file name is the key, and the
 * key fixes the row id, so a boot that finds the row updates it in place and
 * a boot that finds it unchanged writes nothing.
 *
 * The rows belong to {@link SANDBOX_LIBRARY_OWNER}, an address no guest can
 * hold and no `users` row backs. A guest is neither its maker nor an admin, so
 * the creator-or-admin guard (D170) keeps them read-only, and the sharing
 * refusal (D181) keeps guests from putting anything of their own beside them:
 * a guest uses these slides and cannot change them.
 *
 * Only ever written with `SANDBOX_MODE` on; on any other install this is a
 * no-op.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { upsertSandboxLibrarySeed } from '../storage/slide-library.js';
import { createStorageScope } from '../utils/context.js';
import { sandboxEnabled } from '../config/sandbox.js';
import { normalizeLang } from '../../shared/i18n-utils.js';
import { resolveSeedThemeSlug } from '../storage/settings.js';
import { crossOrganizationScope } from '../storage/scope.js';

/** Who the seeded items name as their maker: rendered as "Deckyard". */
export const SANDBOX_LIBRARY_OWNER = 'deckyard@sandbox.local';

const LIBRARY_DIRNAME = path.join('server', 'sandbox-examples', 'library');

/**
 * The stable row id of a seed key: a name-based UUID, so the same file is
 * the same row on every boot and every installation.
 * @param {'slide'|'collection'} kind
 * @param {string} key
 * @returns {string}
 */
export function seedRowId(kind, key) {
  const hex = createHash('sha256')
    .update(`deckyard-sandbox-library:${kind}:${key}`)
    .digest('hex');
  // Version 5 and the RFC 4122 variant, so the value reads as a UUID.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

async function readJsonDir(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const out = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    out.push({
      key: path.basename(name, '.json'),
      file,
      record: JSON.parse(await fs.readFile(file, 'utf8')),
    });
  }
  return out;
}

function refuse(file, field) {
  throw new Error(`Sandbox library seed ${file}: invalid ${field}`);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Read and check the declared seed. A malformed file is a build error, not
 * something to skip: the seed is committed, so it is fixed in the repo.
 * @param {string} repoRoot
 * @returns {Promise<{slides: Array<object>, collections: Array<object>}>}
 */
export async function readSandboxLibrarySeed(repoRoot) {
  const dir = path.join(repoRoot, LIBRARY_DIRNAME);
  const slides = (await readJsonDir(dir)).map(({ key, file, record }) => {
    for (const field of ['name', 'slideType', 'theme'])
      if (!nonEmptyString(record?.[field])) refuse(file, field);
    // The deck-axis spelling, as a library create stores it (`en-GB`, not `en`).
    if (
      !nonEmptyString(record.lang) ||
      normalizeLang(record.lang) !== record.lang
    )
      refuse(file, 'lang');
    if (!record.content || typeof record.content !== 'object')
      refuse(file, 'content');
    return { key, file, ...record };
  });
  const slideKeys = new Set(slides.map((s) => s.key));
  const collections = (await readJsonDir(path.join(dir, 'collections'))).map(
    ({ key, file, record }) => {
      if (!nonEmptyString(record?.name)) refuse(file, 'name');
      if (!Array.isArray(record.slides) || !record.slides.length)
        refuse(file, 'slides');
      for (const slideKey of record.slides)
        if (!slideKeys.has(slideKey)) refuse(file, `slides (${slideKey})`);
      return { key, file, ...record };
    },
  );
  return { slides, collections };
}

/**
 * Write the declared seed onto the organization shelf, idempotently, in one
 * transaction. Does nothing unless the instance runs in sandbox mode.
 * @param {string} repoRoot
 * @returns {Promise<{slides: number, collections: number}>} what the seed holds
 */
export async function seedSandboxLibrary(repoRoot) {
  if (!sandboxEnabled()) return { slides: 0, collections: 0 };
  const { slides, collections } = await readSandboxLibrarySeed(repoRoot);

  const themeIds = new Map();
  for (const slide of slides) {
    if (themeIds.has(slide.theme)) continue;
    const id = await resolveSeedThemeSlug(
      crossOrganizationScope(
        repoRoot,
        'the sandbox library seed names seed themes, which are instance-level configuration',
      ),
      slide.theme,
    );
    if (!id) refuse(slide.file, `theme (${slide.theme} names no seed)`);
    themeIds.set(slide.theme, id);
  }

  await upsertSandboxLibrarySeed(createStorageScope(null), {
    owner: SANDBOX_LIBRARY_OWNER,
    slides: slides.map((slide) => ({
      ...slide,
      id: seedRowId('slide', slide.key),
      themeId: themeIds.get(slide.theme),
    })),
    collections: collections.map((collection) => ({
      ...collection,
      id: seedRowId('collection', collection.key),
    })),
  });
  return { slides: slides.length, collections: collections.length };
}
