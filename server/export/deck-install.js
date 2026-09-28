/**
 * What every definition a `.deck` bundle carries shares (D90, D91): a theme and
 * a DB slide type are both organization records that travel without ids, are
 * recognised on the receiving side by their content, and install under the
 * first free slug without ever overwriting what is there.
 *
 * One definition of each of those rules, so "this definition is already here"
 * and "which slug does it get" cannot mean two things for two kinds of record.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../../shared/slide-fingerprint.js';
import {
  collectThemeImageRefs,
  rewriteThemeImageRefs,
  assetRefForHash,
} from '../../shared/slide-types/deck-assets.js';
import { resolveServedAssetPath } from '../utils/served-asset-path.js';

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Read one served image and name it by content.
 * @param {string} repoRoot
 * @param {string} ref - `/uploads/<file>`
 * @returns {Promise<{buffer: Buffer, hash: string, ext: string, bundleRef: string}|null>}
 *   null when the file is outside the uploads dir or unreadable
 */
export async function readUploadAsset(repoRoot, ref) {
  const resolved = resolveServedAssetPath(repoRoot, ref);
  if (!resolved) return null;
  const abs = resolved.path;
  let buffer;
  try {
    // The lexical check holds for the ref; this one holds for a symlink in
    // the served tree that points out of it.
    const real = await fs.realpath(abs);
    const realBase = await fs.realpath(resolved.dir);
    if (!real.startsWith(realBase + path.sep)) return null;
    buffer = await fs.readFile(abs);
  } catch {
    return null;
  }
  const hash = sha256Hex(buffer);
  const ext = path.extname(abs).slice(1).toLowerCase();
  return { buffer, hash, ext, bundleRef: assetRefForHash(hash, ext) };
}

/**
 * The content hash a carried definition is recognised by: SHA-256 over the
 * canonical JSON of its portable form, uploads named by the hash of their
 * bytes.
 *
 * The slug is left out: it is the definition's address on one instance, not
 * part of what it is. A definition installed under `brand-2` because `brand`
 * was taken is still the bundle's definition.
 * @param {Object} portable - a portable record whose upload refs are bundle refs
 * @returns {string} lowercase hex
 */
export function definitionContentHash(portable) {
  const { slug: _address, ...content } = portable || {};
  // The extension belongs to a local filename, while the content address is
  // the byte hash. The same bytes under a different filename still match.
  const canonical = canonicalJson(content).replace(
    /assets\/([a-f0-9]{64})\.[a-z0-9]+/g,
    'assets/$1',
  );
  return sha256Hex(Buffer.from(canonical, 'utf8'));
}

/**
 * One of this organization's own records in portable form, its uploads named
 * by the hash of their bytes — the receiver's side of
 * {@link definitionContentHash}. An upload whose file cannot be read keeps its
 * `/uploads/` ref, so the record simply never matches a bundle.
 * @param {string} repoRoot
 * @param {Object} portable
 * @returns {Promise<Object>}
 */
export async function withBundleRefs(repoRoot, portable) {
  const map = new Map();
  for (const ref of collectThemeImageRefs(portable)) {
    const asset = await readUploadAsset(repoRoot, ref);
    if (asset) map.set(ref, asset.bundleRef);
  }
  return rewriteThemeImageRefs(portable, (ref) => map.get(ref));
}

/** The longest slug `isValidSlug` accepts. */
const MAX_SLUG_LEN = 80;

/**
 * The slugs to try, in order, for a definition installed from a bundle: its
 * own, then `-2`, `-3`, … — trimmed so the suffix always fits.
 * @param {string} slug
 * @param {string} fallback - the base when the slug is empty
 * @returns {Generator<string>}
 */
function* installSlugCandidates(slug, fallback) {
  const base = String(slug || fallback).slice(0, MAX_SLUG_LEN);
  yield base;
  for (let n = 2; n < 100; n += 1) {
    const suffix = `-${n}`;
    yield `${base.slice(0, MAX_SLUG_LEN - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
}

/**
 * Create a carried definition under the first free slug: its own, then `-2`,
 * `-3`, … An existing record is never overwritten — a taken slug is the only
 * failure that moves on to the next candidate.
 *
 * @template T
 * @param {string} slug - the carried slug
 * @param {string} fallback - the base when the slug is empty
 * @param {(slug: string) => Promise<{ok: boolean, reason?: string} & T>} create
 *   the storage create for one candidate slug
 * @returns {Promise<{ok: boolean, reason?: string} & T>} the result of the last
 *   attempt
 */
export async function installUnderFreeSlug(slug, fallback, create) {
  let result = { ok: false, reason: 'slug_exists' };
  for (const candidate of installSlugCandidates(slug, fallback)) {
    result = await create(candidate);
    if (result.ok || result.reason !== 'slug_exists') return result;
  }
  return result;
}
