import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { curatedFontFaces, mergeFontFaces } from '../../shared/theme-fonts.js';

const LOCK_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scripts',
  'google-fonts.lock.json',
);

/**
 * The pinned font lock, read once.
 *
 * Only the server needs it: `shared/theme-fonts.js` is imported by the theme
 * editor in the browser, so it must stay free of filesystem reads. The lock is
 * the one place that knows *which pinned files are byte-identical*, which is
 * what the grouping below needs.
 */
let lockCache = null;
function readLock() {
  if (lockCache) return lockCache;
  try {
    lockCache = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    lockCache = { fonts: {} };
  }
  return lockCache;
}

/** SHA-256 of the pinned file for one (family, weight, subset), or null. */
function pinnedSha(family, weight, subset) {
  const files = readLock().fonts?.[family]?.files;
  if (!Array.isArray(files)) return null;
  const hit = files.find((f) => f.weight === weight && f.subset === subset);
  return hit?.sha256 || null;
}

/**
 * The `embedFonts` entries a curated family contributes to a theme.
 *
 * Google serves one *variable* woff2 per family × subset and hands back the
 * same file for every weight requested, so a family pinned at 400/500/600/700
 * is four identical files under four names. Emitting one entry per weight made
 * every export base64-inline the same blob four times (~930 KB of fonts in the
 * default theme where ~250 KB is unique) and made the browser fetch it four
 * times over four URLs.
 *
 * So the entries are merged here, once, at the point where a theme's font list
 * is built: weights that share a file collapse into one entry whose `weight` is
 * the variable range (`"400 700"`). Truly static families (Lato, Poppins,
 * Crimson Text, IBM Plex Mono ship one file per weight) keep one entry per
 * weight, because their files really are different bytes.
 *
 * Everything downstream — the browser's `injectThemeFontFaces`, the theme
 * picker's preview CSS, the export embedder — emits what it is given, so there
 * is one spelling of a family's @font-face rules across all of them.
 *
 * @param {string} family - Curated font family name
 * @returns {Array<{family: string, path: string, weight: number|string, style: string, unicodeRange: string}>}
 */
export function curatedEmbedFonts(family) {
  const faces = curatedFontFaces(family).map((face) => ({
    ...face,
    style: 'normal',
    // Identity = "these are the same bytes". The pinned SHA when the lock knows
    // the family; the path otherwise (no grouping, which is the safe default).
    identity: pinnedSha(face.family, face.weight, face.subset) || face.path,
  }));

  return mergeFontFaces(faces).map((face) => ({
    family: face.family,
    path: face.path,
    // Keep a single weight a number (the documented shape); only a merged group
    // needs the CSS range string.
    weight: /\s/.test(face.weight) ? face.weight : Number(face.weight),
    style: face.style,
    unicodeRange: face.unicodeRange,
  }));
}
