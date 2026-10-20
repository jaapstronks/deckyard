import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Collect files depth-first in filesystem order, preserving the root's spelling.
 * By default only regular files are returned and symlinks are skipped.
 * filesOnly:false includes non-directory entries without resolving them;
 * followSymlinks uses stat semantics instead (including errors on broken links).
 * Directory-read errors throw unless missingOk accepts ENOENT or
 * ignoreReadErrors explicitly accepts every directory-read error.
 * @param {string} dir
 * @param {{extensions?: string[], skipDirs?: string[], missingOk?: boolean,
 *   skipEntry?: (entry: import('node:fs').Dirent, full: string) => boolean, filesOnly?: boolean,
 *   followSymlinks?: boolean, ignoreReadErrors?: boolean}} [options]
 * @returns {string[]}
 */
export function walkFiles(
  dir,
  {
    extensions,
    skipDirs = [],
    missingOk = false,
    skipEntry = () => false,
    filesOnly = true,
    followSymlinks = false,
    ignoreReadErrors = false,
  } = {},
) {
  const skipped = new Set(skipDirs);
  const out = [];
  function visit(root) {
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch (err) {
      if (ignoreReadErrors || (missingOk && err.code === 'ENOENT')) return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (skipEntry(entry, full)) continue;
      const type = followSymlinks ? statSync(full) : entry;
      if (type.isDirectory()) {
        if (!skipped.has(entry.name)) visit(full);
      } else if (
        (!filesOnly || type.isFile()) &&
        (!extensions || extensions.some((ext) => entry.name.endsWith(ext)))
      ) {
        out.push(full);
      }
    }
  }
  visit(dir);
  return out;
}
