import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Recursively collect regular files. Symlinks are not followed; unreadable or
 * missing roots throw unless missingOk is explicitly requested for ENOENT.
 * @param {string} dir
 * @param {{extensions?: string[], skipDirs?: string[], missingOk?: boolean}} [options]
 * @returns {string[]} Paths relative to the supplied root's spelling.
 */
export function walkFiles(
  dir,
  { extensions, skipDirs = [], missingOk = false } = {},
) {
  const skipped = new Set(skipDirs);
  const out = [];
  function visit(root) {
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch (err) {
      if (missingOk && err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) visit(full);
      } else if (
        entry.isFile() &&
        (!extensions || extensions.some((ext) => entry.name.endsWith(ext)))
      ) {
        out.push(full);
      }
    }
  }
  visit(dir);
  return out;
}
