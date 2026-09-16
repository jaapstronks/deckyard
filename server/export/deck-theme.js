/**
 * The theme a `.deck` bundle carries (D90) — both directions.
 *
 * A database theme is an organization record: slug, label, logos, colours,
 * fonts and a config (server/storage/themes.js). A presentation points at it by
 * id, and that id means nothing on another instance, so the bundle carries the
 * record itself as `theme.json`: the fields a theme is created from, without
 * ids, with its logos as bundle refs through the same asset walk as the slides.
 *
 * Fonts come in two classes, and only one travels as bytes:
 *
 * - **curated** — the vendored, pinned Google families under open licences
 *   (`assets/fonts/google/`, `scripts/google-fonts.lock.json`). Their files ride
 *   along as content-addressed assets, each face named in the manifest.
 * - **managed** — an organization's font family (`font_families`: upload,
 *   Adobe, Monotype, or a Google family the instance does not vendor). These
 *   travel by name only, with a `fontsNotIncluded` line that says why: a bundle
 *   installs on another instance, and that is redistribution.
 *
 * A file theme (`themes/`, a fork's `custom/themes/`) is not a record: it ships
 * with the install, like a file-JS slide type, and travels by its id alone.
 *
 * On the receiving side a bundled theme is recognised by its content, not by
 * name: {@link themeContentHash} over the installable form, with every logo
 * named by the hash of its bytes. The same function hashes the receiver's own
 * themes, so "this theme is already here" has one definition.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../../shared/slide-fingerprint.js';
import {
  collectUploadRefsIn,
  rewriteUploadRefsIn,
  assetRefForHash,
} from '../../shared/slide-types/deck-assets.js';
import {
  curatedFontFaces,
  isValidFont,
  DEFAULT_HEADING_FONT,
  DEFAULT_BODY_FONT,
} from '../../shared/theme-fonts.js';
import { validateThemeConfig } from '../../shared/theme-config-schema.js';
import { UUID_RE } from '../utils/uuid.js';
import { uploadsDir } from '../config/storage-paths.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { createTheme, getThemeRecord, listThemes } from '../storage/themes.js';
import { listAllFontFamiliesWithVariants } from '../storage/font-families.js';

/** Where the carried theme lives inside the archive. */
export const THEME_ENTRY = 'theme.json';

/** The two font roles a theme record names. */
const FONT_ROLES = [
  { role: 'heading', idKey: 'headingFamilyId', fallback: DEFAULT_HEADING_FONT },
  { role: 'body', idKey: 'bodyFamilyId', fallback: DEFAULT_BODY_FONT },
];

/**
 * Why a font did not travel as bytes. A closed vocabulary, documented in
 * docs/reference/deck-bundle-format.md § Theme.
 */
const FONT_NOT_INCLUDED_REASONS = Object.freeze({
  /** Upload, Adobe or Monotype: licensed to the sending organization. */
  licensed: 'licensed',
  /** Not vendored on the sending instance, so there are no bytes to carry. */
  notVendored: 'not-vendored',
});

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Resolve a `/uploads/<file>` ref to an absolute path under the uploads dir,
 * or null if it would escape it. Uses the env/sandbox-aware uploadsDir.
 * @param {string} repoRoot
 * @param {string} ref
 * @returns {string|null}
 */
function resolveUploadPath(repoRoot, ref) {
  const base = path.resolve(uploadsDir(repoRoot));
  const rel = decodeURIComponent(String(ref).replace(/^\/uploads\//, ''));
  const abs = path.resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

/**
 * Read one upload and name it by content.
 * @param {string} repoRoot
 * @param {string} ref - `/uploads/<file>`
 * @returns {Promise<{buffer: Buffer, hash: string, ext: string, bundleRef: string}|null>}
 *   null when the file is outside the uploads dir or unreadable
 */
export async function readUploadAsset(repoRoot, ref) {
  const abs = resolveUploadPath(repoRoot, ref);
  if (!abs) return null;
  let buffer;
  try {
    buffer = await fs.readFile(abs);
  } catch {
    return null;
  }
  const hash = sha256Hex(buffer);
  const ext = path.extname(abs).slice(1).toLowerCase();
  return { buffer, hash, ext, bundleRef: assetRefForHash(hash, ext) };
}

/**
 * The installable form of a theme record: exactly the fields `createTheme`
 * takes, nothing that belongs to the instance (id, organization, default flag,
 * authorship, timestamps) and no font-family ids (those are rows in the sending
 * organization; the family travels by name).
 *
 * @param {Object} record - a formatted theme record (storage/themes.js)
 * @returns {{slug: string, label: string, logoUrl: string|null, logoSmallUrl: string|null, colors: Object, fonts: {heading: string, body: string}, config: Object}}
 */
export function portableThemeRecord(record) {
  const fonts = record?.fonts || {};
  return {
    slug: String(record?.slug || ''),
    label: String(record?.label || ''),
    logoUrl: record?.logoUrl || null,
    logoSmallUrl: record?.logoSmallUrl || null,
    colors: record?.colors || {},
    fonts: {
      heading: fonts.heading || DEFAULT_HEADING_FONT,
      body: fonts.body || DEFAULT_BODY_FONT,
    },
    config: validateThemeConfig(record?.config),
  };
}

/**
 * The content hash a bundled theme is recognised by: SHA-256 over the canonical
 * JSON of its installable form, logos named by the hash of their bytes.
 *
 * The slug is left out: it is the theme's address on one instance, not part of
 * what the theme looks like. A theme installed under `brand-2` because `brand`
 * was taken is still the bundle's theme.
 * @param {Object} portable - a portable theme whose upload refs are bundle refs
 * @returns {string} lowercase hex
 */
function themeContentHash(portable) {
  const { slug: _address, ...content } = portable || {};
  return sha256Hex(Buffer.from(canonicalJson(content), 'utf8'));
}

/**
 * The theme record behind a presentation's theme id, or null for a file theme
 * (or a database theme that no longer exists).
 *
 * The UUID came out of the deck being exported, which the route already
 * authorized; like every render and export path this carries no session, so
 * the read is the cross-organization category 1.
 * @param {string|null} repoRoot
 * @param {string} rawThemeId - `presentation.theme` as stored
 * @returns {Promise<Object|null>}
 */
export async function loadBundleableTheme(repoRoot, rawThemeId) {
  const id = String(rawThemeId || '')
    .trim()
    .toLowerCase();
  if (!UUID_RE.test(id)) return null;
  return getThemeRecord(
    crossOrganizationScope(
      repoRoot ?? null,
      'theme UUID resolved from the deck being exported; export paths carry no session',
    ),
    id,
  );
}

/**
 * What a theme record's fonts become in a bundle.
 *
 * @param {string} repoRoot
 * @param {Object} record - the theme record (with `organizationId`)
 * @returns {Promise<{faces: Array<{family: string, weight: number, subset: string, buffer: Buffer, hash: string}>, notIncluded: Array<{family: string, role: string, source: string, reason: string}>}>}
 */
export async function bundleThemeFonts(repoRoot, record) {
  const fonts = record?.fonts || {};
  const needsManaged = FONT_ROLES.some((r) => fonts[r.idKey]);
  const managed =
    needsManaged && record?.organizationId
      ? await listAllFontFamiliesWithVariants({
          organizationId: record.organizationId,
        })
      : [];
  const managedById = new Map(managed.map((f) => [f.id, f]));

  const faces = [];
  const notIncluded = [];
  const seenFamilies = new Set();
  for (const { role, idKey, fallback } of FONT_ROLES) {
    const family = fonts[role] || fallback;
    const familyId = fonts[idKey];
    if (familyId) {
      const source = managedById.get(familyId)?.source || 'upload';
      notIncluded.push({
        family,
        role,
        source,
        reason:
          source === 'google'
            ? FONT_NOT_INCLUDED_REASONS.notVendored
            : FONT_NOT_INCLUDED_REASONS.licensed,
      });
      continue;
    }
    if (seenFamilies.has(family)) continue;
    seenFamilies.add(family);

    const curated = curatedFontFaces(family);
    const read = [];
    for (const face of curated) {
      try {
        const buffer = await fs.readFile(path.join(repoRoot, face.path));
        read.push({
          family: face.family,
          weight: face.weight,
          subset: face.subset,
          buffer,
          hash: sha256Hex(buffer),
        });
      } catch {
        read.length = 0;
        break;
      }
    }
    if (curated.length && read.length === curated.length) {
      faces.push(...read);
    } else {
      // Not a family this instance vendors (or its postinstall download was
      // skipped): the name travels, the bytes cannot.
      notIncluded.push({
        family,
        role,
        source: 'curated',
        reason: FONT_NOT_INCLUDED_REASONS.notVendored,
      });
    }
  }
  return { faces, notIncluded };
}

/**
 * The installable form of one of this organization's own themes, logos named
 * by the hash of their bytes — the receiver's side of {@link themeContentHash}.
 * A logo whose file cannot be read keeps its `/uploads/` ref, so it simply
 * never matches a bundle.
 * @param {string} repoRoot
 * @param {Object} record
 * @returns {Promise<Object>}
 */
async function hashableThemeRecord(repoRoot, record) {
  const portable = portableThemeRecord(record);
  const refs = collectUploadRefsIn(portable);
  const map = new Map();
  for (const ref of refs) {
    const asset = await readUploadAsset(repoRoot, ref);
    if (asset) map.set(ref, asset.bundleRef);
  }
  return rewriteUploadRefsIn(portable, (ref) => map.get(ref));
}

/**
 * This organization's theme with exactly this content, or null.
 * @param {string} repoRoot
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {string} hash - {@link themeContentHash} of the bundled theme
 * @returns {Promise<Object|null>} the theme record
 */
async function findThemeByContent(repoRoot, scope, hash) {
  for (const record of await listThemes(scope)) {
    const hashable = await hashableThemeRecord(repoRoot, record);
    if (themeContentHash(hashable) === hash) return record;
  }
  return null;
}

/**
 * Bind a bundled theme's fonts to this organization.
 *
 * A curated family this instance vendors is used by name. A managed family is
 * bound to this organization's family of the same name, when it has one. A
 * family that is neither falls back to the default for its role — the theme
 * renders on the font stack, as D90 says a receiver without the font does —
 * and is listed in `fontsMissing` so the response says so.
 *
 * The result is the form the theme installs as, and so the form it is
 * recognised by next time: a second import of the same bundle resolves the
 * same way and hashes the same.
 *
 * @param {Object} theme - the bundled `theme.json`
 * @param {import('../storage/scope.js').StorageScope} scope
 * @returns {Promise<{theme: Object, familyIds: Object, fontsMissing: string[]}>}
 *   `theme` in portable form (names only); `familyIds` the `*FamilyId` keys to
 *   add when creating the record
 */
async function resolveBundledThemeFonts(theme, scope) {
  const fonts = theme?.fonts || {};
  let managed = null;
  const familyIds = {};
  const fontsMissing = [];
  const resolved = {};
  for (const { role, idKey, fallback } of FONT_ROLES) {
    const family = typeof fonts[role] === 'string' ? fonts[role] : fallback;
    if (isValidFont(family)) {
      resolved[role] = family;
      continue;
    }
    managed ??= await listAllFontFamiliesWithVariants(scope);
    const own = managed.find((f) => f.name === family);
    if (own) {
      resolved[role] = family;
      familyIds[idKey] = own.id;
      continue;
    }
    resolved[role] = fallback;
    if (!fontsMissing.includes(family)) fontsMissing.push(family);
  }
  return {
    theme: portableThemeRecord({ ...theme, fonts: resolved }),
    familyIds,
    fontsMissing,
  };
}

/** The longest slug `isValidSlug` accepts. */
const MAX_SLUG_LEN = 80;

/**
 * The slugs to try, in order, for a theme installed from a bundle: its own,
 * then `-2`, `-3`, … — trimmed so the suffix always fits.
 * @param {string} slug
 * @returns {Generator<string>}
 */
function* installSlugCandidates(slug) {
  const base = String(slug || 'theme').slice(0, MAX_SLUG_LEN);
  yield base;
  for (let n = 2; n < 100; n += 1) {
    const suffix = `-${n}`;
    yield `${base.slice(0, MAX_SLUG_LEN - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
}

/**
 * Decide what a bundled theme becomes on this instance (D90), before any bytes
 * are written.
 *
 * - **existing** — this organization already has a theme with exactly this
 *   content: the deck lands on it. Nothing is installed, so nothing is asked of
 *   the importer; a same-instance round trip lands where it started.
 * - **install** — the importer may manage themes and asked for it
 *   (`install=theme`): the theme is created, never over an existing one.
 * - **not-installed** — otherwise; the deck lands on the organization default
 *   and the response says a manager can install the theme.
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {import('../storage/scope.js').StorageScope} opts.scope
 * @param {Object} opts.theme - the bundle's `theme.json`
 * @param {boolean} opts.install - `install=theme` was asked
 * @param {boolean} opts.permitted - the importer may manage themes
 * @returns {Promise<{status: 'existing', record: Object, fontsMissing: string[]} | {status: 'install', theme: Object, familyIds: Object, fontsMissing: string[]} | {status: 'not-installed', reason: 'install-not-requested'|'not-permitted', fontsMissing: string[]}>}
 */
export async function settleBundledTheme({
  repoRoot,
  scope,
  theme,
  install,
  permitted,
}) {
  const resolved = await resolveBundledThemeFonts(theme, scope);
  const record = await findThemeByContent(
    repoRoot,
    scope,
    themeContentHash(resolved.theme),
  );
  if (record) {
    return { status: 'existing', record, fontsMissing: resolved.fontsMissing };
  }
  if (install && permitted) {
    return { status: 'install', ...resolved };
  }
  return {
    status: 'not-installed',
    reason: install ? 'not-permitted' : 'install-not-requested',
    fontsMissing: resolved.fontsMissing,
  };
}

/**
 * Create a carried theme under the first free slug: its own, then `-2`, `-3`,
 * … An existing theme is never overwritten — a taken slug is the only failure
 * that moves on to the next candidate.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {Object} theme - the resolved theme, logos already upload refs
 * @param {Object} familyIds - the `*FamilyId` keys bound by
 *   {@link resolveBundledThemeFonts}
 * @returns {Promise<{ok: true, theme: Object} | {ok: false, reason: string, field?: string}>}
 *   the storage result of the last attempt
 */
export async function installBundledTheme(scope, theme, familyIds) {
  let result = { ok: false, reason: 'slug_exists' };
  for (const slug of installSlugCandidates(theme.slug)) {
    result = await createTheme(scope, {
      ...theme,
      slug,
      fonts: { ...theme.fonts, ...familyIds },
    });
    if (result.ok || result.reason !== 'slug_exists') return result;
  }
  return result;
}
