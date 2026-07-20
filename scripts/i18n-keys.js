/**
 * Shared t() key extraction.
 *
 * Scans client/ for `t('key', 'English fallback')` call sites and returns the
 * static keys with their fallbacks. Used by both `scripts/i18n-validate.js`-style
 * tooling and `tests/i18n-coverage.test.js`, so the drift guard and the fill
 * tooling always agree on what "a key the code uses" means.
 *
 * Only *statically literal* keys are returned. Some call sites build keys at
 * runtime (e.g. `t(`slideType.${type}.label`, …)` in slide-library/controls.js);
 * those are unknowable here and are deliberately excluded rather than guessed —
 * see DYNAMIC_KEY_PREFIXES for the families they cover.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Directories under client/ that never contain app copy. */
const IGNORE_DIRS = new Set(['vendor', 'styles', 'i18n']);

/**
 * Key families that are constructed dynamically and therefore cannot be
 * verified statically. Keys under these prefixes are exempt from the
 * "unused key" side of the drift check.
 */
export const DYNAMIC_KEY_PREFIXES = ['slideType.'];

// t( '<key>' [, '<fallback>'] ) — single or double quoted, allowing escapes.
// The fallback alternates on the delimiter rather than using one character
// class, so a fallback may contain the *other* quote: t('k', "Logo's") and
// t('k', 'A "quoted" phrase') both extract correctly.
const T_CALL =
  /\bt\(\s*(['"])([\w.\-]+)\1\s*(?:,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"))?/g;

/**
 * Walk a directory tree yielding .js file paths.
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkJs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walkJs(full);
    } else if (entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

/**
 * Extract every static t() key used in the client.
 * @param {string} clientDir - absolute path to client/
 * @returns {Promise<Map<string, { file: string, fallback: string|null }>>}
 */
export async function extractUsedKeys(clientDir) {
  /** @type {Map<string, { file: string, fallback: string|null }>} */
  const used = new Map();
  for await (const file of walkJs(clientDir)) {
    const src = await fs.readFile(file, 'utf8');
    for (const m of src.matchAll(T_CALL)) {
      const key = m[2];
      const fallback = m[3] ?? m[4] ?? null;
      const prev = used.get(key);
      // Prefer the first call site that actually supplies a fallback.
      if (!prev || (prev.fallback == null && fallback != null)) {
        used.set(key, { file, fallback });
      }
    }
  }
  return used;
}

/**
 * Load a locale's merged dictionary from client/i18n/<locale>/*.json.
 * @param {string} i18nDir - absolute path to client/i18n/
 * @param {string} locale
 * @returns {Promise<Record<string, string>>}
 */
export async function loadLocale(i18nDir, locale) {
  const dir = path.join(i18nDir, locale);
  const merged = Object.create(null);
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return merged;
  }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(dir, name), 'utf8');
    Object.assign(merged, JSON.parse(raw));
  }
  return merged;
}

/**
 * @param {string} key
 * @returns {boolean} true when the key belongs to a runtime-built family
 */
export function isDynamicKey(key) {
  return DYNAMIC_KEY_PREFIXES.some((p) => key.startsWith(p));
}
