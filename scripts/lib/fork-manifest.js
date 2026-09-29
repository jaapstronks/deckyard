/**
 * What a fork owns, read from one declaration: `custom/fork.json`.
 *
 * A fork of Deckyard is upstream's tree plus the fork's own files. Which is
 * which used to live only in prose — each fork kept a table of its paths and a
 * list of the core files it patched in its own `FORK.md` — so no tool could
 * ask. The doc gate needed a fork's private doc tree and got it by a patch to
 * its own constant; the merge-round seam check was a shell recipe copied
 * between forks. This module is the machine-readable half of that convention
 * (B426), and `docs/reference/fork-setup.md` § What the fork owns is the prose
 * half.
 *
 * The convention, in three rules:
 *
 *   - `custom/` is the fork's, always. Listing it (or a path under it) in the
 *     manifest is refused: a second spelling of a rule that already holds.
 *   - `CLAUDE.md` is the installation's agent entry, always. Upstream's is two
 *     import lines that do not change, so a fork writes its own without a seam.
 *   - everything else is core, unless the manifest says otherwise: `owned`
 *     names further fork paths (a doc tree, a fork-only test), `deviations`
 *     names core files the fork patches on purpose, each with its reason.
 *
 * The manifest describes the repository, not the runtime, so it lives at
 * `custom/fork.json` in the checkout even when `DECKYARD_CUSTOM_DIR` moves the
 * runtime fork root elsewhere. Upstream ships none; a missing file is an empty
 * manifest.
 *
 * @module scripts/lib/fork-manifest
 */

import fs from 'node:fs';
import path from 'node:path';

/** The manifest's path, repo-relative. */
export const FORK_MANIFEST_PATH = 'custom/fork.json';

/** Paths every fork owns without declaring them. */
export const ALWAYS_OWNED = ['custom/', 'CLAUDE.md'];

/**
 * Core files a fork is told to edit by `docs/reference/fork-setup.md`, so a
 * difference there is a documented seam, not drift.
 */
export const DOCUMENTED_SEAMS = {
  '.gitignore':
    'fork-setup.md Step 2: a fork un-ignores the custom/ content it versions',
};

const FIELDS = new Set(['owned', 'deviations']);

/**
 * @typedef {object} ForkManifest
 * @property {string[]} owned                 fork paths outside `custom/`; a trailing `/` marks a tree
 * @property {Record<string, string>} deviations  core file → why the fork patches it
 */

/**
 * Refuse a path that is not a plain repo-relative path.
 *
 * @param {string} p
 * @param {string} where - the field, for the message
 */
function assertRepoPath(p, where) {
  if (typeof p !== 'string' || !p.trim()) {
    throw new Error(`${FORK_MANIFEST_PATH}: ${where} must be a non-empty path`);
  }
  if (
    path.isAbsolute(p) ||
    p.startsWith('./') ||
    p.split('/').includes('..') ||
    p.includes('\\')
  ) {
    throw new Error(
      `${FORK_MANIFEST_PATH}: ${where} "${p}" must be repo-relative, without ./, .. or backslashes`,
    );
  }
  if (ALWAYS_OWNED.some((o) => (o.endsWith('/') ? p.startsWith(o) : p === o))) {
    throw new Error(
      `${FORK_MANIFEST_PATH}: ${where} "${p}" is fork-owned already (${ALWAYS_OWNED.join(', ')}); drop it`,
    );
  }
}

/**
 * Validate a parsed manifest. Unknown fields, malformed paths, a path listed
 * twice and a deviation without a reason are refused, not repaired.
 *
 * @param {unknown} raw
 * @returns {ForkManifest}
 */
export function parseForkManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${FORK_MANIFEST_PATH} must be a JSON object`);
  }
  for (const key of Object.keys(raw)) {
    if (!FIELDS.has(key)) {
      throw new Error(
        `${FORK_MANIFEST_PATH}: unknown field "${key}" (known: ${[...FIELDS].join(', ')})`,
      );
    }
  }
  const owned = raw.owned ?? [];
  if (!Array.isArray(owned)) {
    throw new Error(`${FORK_MANIFEST_PATH}: "owned" must be an array of paths`);
  }
  owned.forEach((p) => assertRepoPath(p, 'owned'));
  if (new Set(owned).size !== owned.length) {
    throw new Error(`${FORK_MANIFEST_PATH}: "owned" lists a path twice`);
  }

  const deviations = raw.deviations ?? {};
  if (typeof deviations !== 'object' || Array.isArray(deviations)) {
    throw new Error(
      `${FORK_MANIFEST_PATH}: "deviations" must map a core file to its reason`,
    );
  }
  for (const [file, why] of Object.entries(deviations)) {
    assertRepoPath(file, 'deviations');
    if (file.endsWith('/')) {
      throw new Error(
        `${FORK_MANIFEST_PATH}: deviation "${file}" names a tree; a deviation is one core file`,
      );
    }
    if (typeof why !== 'string' || why.trim().length < 10) {
      throw new Error(
        `${FORK_MANIFEST_PATH}: deviation "${file}" needs a real reason, not "${why}"`,
      );
    }
    if (isOwnedBy(owned, file)) {
      throw new Error(
        `${FORK_MANIFEST_PATH}: "${file}" is both owned and a deviation; it is one or the other`,
      );
    }
  }
  return { owned: [...owned], deviations: { ...deviations } };
}

/**
 * Read the manifest of a checkout. A missing file is an empty manifest; a
 * present one that does not parse or validate throws.
 *
 * @param {string} repoRoot - absolute path of the checkout
 * @returns {ForkManifest}
 */
export function readForkManifest(repoRoot) {
  let text;
  try {
    text = fs.readFileSync(path.join(repoRoot, FORK_MANIFEST_PATH), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { owned: [], deviations: {} };
    throw err;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${FORK_MANIFEST_PATH} is not valid JSON: ${err.message}`, {
      cause: err,
    });
  }
  return parseForkManifest(raw);
}

/**
 * @param {string[]} paths - owned paths; a trailing `/` marks a tree
 * @param {string} rel - repo-relative path
 */
function isOwnedBy(paths, rel) {
  return paths.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
}

/**
 * Whether a repo-relative path belongs to the fork rather than to core.
 *
 * @param {ForkManifest} manifest
 * @param {string} rel
 * @returns {boolean}
 */
export function isForkOwned(manifest, rel) {
  return isOwnedBy([...ALWAYS_OWNED, ...manifest.owned], rel);
}
