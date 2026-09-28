/**
 * Turn a served ref back into the file it names (B509).
 *
 * Three exports read a deck's local refs from disk — the render embed
 * (`html-utils.js`), the `.deck` bundle (`deck-install.js`) and the bulk
 * export (`bulk-export.js`). Each used to carry its own prefix → root table,
 * and they drifted: the bulk export read `/custom/assets/` from the checkout
 * while the other two honoured a moved fork root. There is now one table,
 * {@link servedDirsFor} (the same one the static mounts are), and one
 * resolver on top of it.
 */

import path from 'node:path';

import { isServedAssetRef } from '../../shared/slide-types/deck-assets.js';
import { servedDirsFor } from '../config/paths.js';

/**
 * Resolve a root-relative URL path to the file this installation serves for
 * it, contained in the directory it is served from. The URL is decoded the
 * way the static mount decodes it, so `/assets/a%20b.png` names `a b.png`.
 *
 * This is the security boundary for every caller: `ref` comes from deck
 * content, so `..`/absolute segments must never reach the filesystem. The
 * caller's predicate already refuses traversal shapes; the containment check
 * holds regardless. It does not decide *which* refs a caller may read — that
 * is the caller's predicate ({@link resolveServedAssetPath} for the asset
 * class).
 * @param {string} root - Installation root
 * @param {string} ref - A root-relative URL path (e.g. `/assets/x.png`)
 * @returns {{path: string, dir: string}|null} The contained absolute path and
 *   the served directory it lies in, or null
 */
export function resolveServedPath(root, ref) {
  if (typeof ref !== 'string') return null;
  const mount = servedDirsFor(root).find((m) => ref.startsWith(m.urlPrefix));
  if (!mount) return null;
  let rel;
  try {
    rel = decodeURIComponent(ref.slice(mount.urlPrefix.length));
  } catch {
    return null;
  }
  const dir = path.resolve(mount.dir);
  const abs = path.resolve(dir, rel);
  if (!abs.startsWith(dir + path.sep)) return null;
  return { path: abs, dir };
}

/**
 * {@link resolveServedPath} for exactly the deck-asset class,
 * {@link isServedAssetRef}: an upload, `/assets/` or `/custom/assets/`.
 * @param {string} root - Installation root
 * @param {string} ref
 * @returns {{path: string, dir: string}|null}
 */
export function resolveServedAssetPath(root, ref) {
  return isServedAssetRef(ref) ? resolveServedPath(root, ref) : null;
}
