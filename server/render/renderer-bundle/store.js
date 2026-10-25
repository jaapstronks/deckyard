/**
 * The render-bundle store: bundles on disk, addressed by their hash.
 *
 * Layout, one directory per bundle:
 *
 *   <store>/<rendererHash>/manifest.json    canonical bytes; sha256 == dirname
 *   <store>/<rendererHash>/provenance.json  version/commit/build time, unhashed
 *   <store>/<rendererHash>/files/<path>     the renderer tree, repo-relative
 *
 * `files/` mirrors the source tree rather than flattening it to
 * `files/<sha256>`, because the modules in it import each other by relative
 * path and a sealed worker has no loader hook to resolve a flat store with.
 * Content-addressing lives where it has to: in the manifest, which names every
 * file by digest, and in the directory name, which is the digest of the
 * manifest. `openRendererBundle()` verifies both before anything executes, so
 * the mirrored tree is a *verified materialisation* of the content-addressed
 * record, not a second source of truth.
 *
 * Verification is total in both directions: every file the manifest names must
 * be present and hash correctly, and no file under `files/` may be absent from
 * the manifest. One-directional verification would let an attacker who can
 * write the store plant a module the manifest never mentions and have it loaded
 * by a relative import.
 */

import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { RENDERER_BUNDLE_ERRORS, RendererBundleError } from './errors.js';
import {
  RENDERER_BUNDLE_SCHEMA,
  canonicalManifestBytes,
  isRendererHash,
  sha256Hex,
  validateRendererBundleManifest,
} from './manifest.js';

/** Name of the manifest inside a bundle directory. */
export const MANIFEST_NAME = 'manifest.json';
/** Name of the unhashed provenance record inside a bundle directory. */
export const PROVENANCE_NAME = 'provenance.json';
/** Directory the renderer tree is mirrored into. */
export const FILES_DIR = 'files';

/**
 * @typedef {Object} OpenRendererBundle
 * @property {string} rendererHash
 * @property {string} dir - Absolute path of the bundle directory
 * @property {string} filesDir - Absolute path of the renderer tree
 * @property {object} manifest - The parsed manifest
 * @property {object|null} provenance - Parsed provenance, or null when absent
 */

/** Every file under `dir`, as paths relative to it, in sorted order. */
async function listFilesRecursive(dir) {
  const out = [];
  async function walk(current, prefix) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
      else out.push(rel);
    }
  }
  await walk(dir, '');
  return out.sort();
}

/**
 * Open a bundle by hash, verifying its manifest and every byte it names.
 *
 * @param {string} storeDir - Directory holding bundle directories
 * @param {string} rendererHash - The bundle's identity
 * @returns {Promise<OpenRendererBundle>}
 * @throws {RendererBundleError} On a malformed, unknown, incomplete or corrupt
 *   bundle. Never falls back to another bundle.
 */
export async function openRendererBundle(storeDir, rendererHash) {
  if (!isRendererHash(rendererHash)) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.MALFORMED_HASH,
      `renderer hash must be 64 lowercase hex characters, got ${JSON.stringify(String(rendererHash).slice(0, 80))}`,
    );
  }
  // Through `realpath`, because the bundle directory is what the worker is
  // granted read access to and what its own path is resolved from. On a macOS
  // temp directory (`/var/folders/...` -> `/private/var/folders/...`) granting
  // the symlinked spelling denies the process its own entry point.
  let dir = path.join(storeDir, rendererHash);
  try {
    dir = await realpath(dir);
  } catch {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.UNKNOWN,
      `no render bundle ${rendererHash} in ${storeDir}`,
      { rendererHash },
    );
  }
  let manifestBytes;
  try {
    manifestBytes = await readFile(path.join(dir, MANIFEST_NAME));
  } catch {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.UNKNOWN,
      `no render bundle ${rendererHash} in ${storeDir}`,
      { rendererHash },
    );
  }

  // The directory name is a claim about these bytes. Check the claim before
  // parsing them, so a tampered manifest is refused as corrupt rather than
  // interpreted.
  const actual = sha256Hex(manifestBytes);
  if (actual !== rendererHash) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.CORRUPT,
      `manifest of ${rendererHash} hashes to ${actual}`,
      { rendererHash, actual },
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (err) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.CORRUPT,
      `manifest of ${rendererHash} is not JSON: ${err.message}`,
    );
  }
  if (manifest?.schema !== RENDERER_BUNDLE_SCHEMA) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.CORRUPT,
      `manifest of ${rendererHash} declares schema ${JSON.stringify(manifest?.schema)}, expected ${RENDERER_BUNDLE_SCHEMA}`,
    );
  }
  // A manifest whose canonical form is not the bytes on disk is not canonical,
  // so its hash would mean something different to the next reader.
  try {
    validateRendererBundleManifest(manifest);
    if (!canonicalManifestBytes(manifest).equals(manifestBytes)) {
      throw new Error('not in canonical form');
    }
  } catch (err) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.CORRUPT,
      `manifest of ${rendererHash} is invalid: ${err.message}`,
    );
  }

  const filesDir = path.join(dir, FILES_DIR);
  try {
    if (!(await lstat(filesDir)).isDirectory())
      throw new Error('not a directory');
  } catch {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.INCOMPLETE,
      `render bundle ${rendererHash} has no ordinary ${FILES_DIR}/ directory`,
    );
  }
  let present;
  try {
    present = await listFilesRecursive(filesDir);
  } catch {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.INCOMPLETE,
      `render bundle ${rendererHash} has no ${FILES_DIR}/ directory`,
    );
  }
  const declared = new Set(manifest.files.map((f) => f.path));
  const extra = present.filter((p) => !declared.has(p));
  if (extra.length) {
    throw new RendererBundleError(
      RENDERER_BUNDLE_ERRORS.INCOMPLETE,
      `render bundle ${rendererHash} holds ${extra.length} file(s) the manifest does not name: ${extra.slice(0, 5).join(', ')}`,
      { extra },
    );
  }

  for (const entry of manifest.files) {
    const abs = path.join(filesDir, entry.path);
    let current = filesDir;
    try {
      const parts = entry.path.split('/');
      for (const [index, part] of parts.entries()) {
        current = path.join(current, part);
        const info = await lstat(current);
        if (index === parts.length - 1 ? !info.isFile() : !info.isDirectory()) {
          throw new Error('not an ordinary file path');
        }
      }
    } catch {
      throw new RendererBundleError(
        RENDERER_BUNDLE_ERRORS.INCOMPLETE,
        `render bundle ${rendererHash}: ${entry.path} is not an ordinary file inside ${FILES_DIR}/`,
        { path: entry.path },
      );
    }
    let bytes;
    try {
      bytes = await readFile(abs);
    } catch {
      throw new RendererBundleError(
        RENDERER_BUNDLE_ERRORS.INCOMPLETE,
        `render bundle ${rendererHash} is missing ${entry.path}`,
        { path: entry.path },
      );
    }
    if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256) {
      throw new RendererBundleError(
        RENDERER_BUNDLE_ERRORS.CORRUPT,
        `render bundle ${rendererHash}: ${entry.path} does not match its digest`,
        { path: entry.path },
      );
    }
  }

  return {
    rendererHash,
    dir,
    filesDir,
    manifest,
    provenance: await readProvenance(dir),
  };
}

/**
 * A bundle's provenance record, or null when it has none.
 *
 * Outside the hash and therefore optional: a bundle without it is still exactly
 * the renderer its hash says it is, so an unreadable or unparseable file is an
 * absent answer rather than a refusal.
 *
 * @param {string} dir - The bundle directory
 * @returns {Promise<object|null>}
 */
async function readProvenance(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, PROVENANCE_NAME), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The hashes of every bundle in a store, sorted.
 *
 * @param {string} storeDir
 * @returns {Promise<string[]>}
 */
export async function listRendererBundles(storeDir) {
  let entries;
  try {
    entries = await readdir(storeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const hashes = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isRendererHash(entry.name)) continue;
    try {
      await stat(path.join(storeDir, entry.name, MANIFEST_NAME));
      hashes.push(entry.name);
    } catch {
      // A directory without a manifest is not a bundle, so it is left out of
      // the returned list; that omission is the record of the failure.
      continue;
    }
  }
  return hashes.sort();
}
