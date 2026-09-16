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
  collectUploadRefsIn,
  rewriteUploadRefsIn,
  assetRefForHash,
} from '../../shared/slide-types/deck-assets.js';
import { uploadsDir } from '../config/storage-paths.js';

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
  return sha256Hex(Buffer.from(canonicalJson(content), 'utf8'));
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
  for (const ref of collectUploadRefsIn(portable)) {
    const asset = await readUploadAsset(repoRoot, ref);
    if (asset) map.set(ref, asset.bundleRef);
  }
  return rewriteUploadRefsIn(portable, (ref) => map.get(ref));
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
