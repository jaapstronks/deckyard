/**
 * The filesystem half of the i18n tooling: where the repo is, which trees to
 * walk, and how a locale file is read and written.
 *
 * Every one of these had two or three spellings across `scripts/i18n-*.js`
 * before B147 — `walkJs` twice, `IGNORE_DIRS` twice, JSON reading three times,
 * JSON writing twice (one of which sorted only sometimes), the merged-locale
 * load three times, and the repo-root computation in two shapes. None of the
 * copies disagreed on purpose; they disagreed because nobody could see the
 * other one. They live here now, once.
 *
 * Async throughout, deliberately: `i18n-sync.js` was the last synchronous
 * script and a second, sync-flavoured copy of these four functions is exactly
 * the shape this module exists to remove. `findDuplicateKeys()` is the one
 * exception in kind rather than in shape: it reads a locale file's *raw text*,
 * because that is the only place a repeated JSON key survives.
 *
 * @module scripts/lib/i18n-fs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the repository root. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** Absolute path to `client/`. */
export const CLIENT_DIR = path.join(REPO_ROOT, 'client');

/** Absolute path to `client/i18n/`. */
export const I18N_DIR = path.join(CLIENT_DIR, 'i18n');

/**
 * Directories under `client/` that never contain app copy.
 *
 * `vendor` is third-party, `styles` is CSS, and `i18n` is the translations
 * themselves — scanning it for `t()` calls would find the strings rather than
 * the call sites.
 */
export const IGNORE_DIRS = new Set(['vendor', 'styles', 'i18n']);

/**
 * Walk a directory tree yielding `.js` file paths, skipping IGNORE_DIRS.
 * @param {string} dir - absolute path to walk
 * @returns {AsyncGenerator<string>}
 */
export async function* walkJs(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
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
 * Read a JSON file, or `null` when it is missing or unparseable.
 *
 * The two are deliberately one answer: every caller here treats "no file" and
 * "not JSON" the same way — skip it and let the gate that owns syntax
 * (`tests/i18n-coverage.test.js`) be the one that fails.
 *
 * @param {string} filePath - absolute path
 * @returns {Promise<Record<string, string>|null>}
 */
export async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write a flat dictionary as a locale file: keys sorted, two-space indent,
 * trailing newline.
 *
 * Always sorted. `tests/i18n-locales.test.js` fails on an unsorted locale file,
 * so a writer that preserved order would only ever produce a file the suite
 * rejects.
 *
 * @param {string} filePath - absolute path
 * @param {Record<string, string>} data
 * @returns {Promise<void>}
 */
export async function writeJson(filePath, data) {
  const sorted = Object.fromEntries(
    Object.keys(data)
      .sort()
      .map((k) => [k, data[k]]),
  );
  await fs.writeFile(filePath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/**
 * Load a locale's merged dictionary from `client/i18n/<locale>/*.json`.
 *
 * The runtime keeps the modules apart (each has its own loader), but every
 * question the tooling asks — is this key translated, which keys does this
 * locale hold — is about the locale as a whole. A missing locale directory
 * yields an empty dictionary rather than throwing: "this locale has nothing"
 * is a valid answer to all of those questions.
 *
 * @param {string} i18nDir - absolute path to `client/i18n/`
 * @param {string} locale
 * @returns {Promise<Record<string, string>>}
 */
export async function loadLocale(i18nDir, locale) {
  const dir = path.join(i18nDir, locale);
  const merged = Object.create(null);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return merged;
  }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const dict = await readJson(path.join(dir, name));
    if (dict) Object.assign(merged, dict);
  }
  return merged;
}

/**
 * Duplicate keys, found over the raw text because `JSON.parse` keeps only the
 * last of a repeated key and so erases the very evidence of the bug. The i18n
 * files are flat, one-key-per-line maps (as `i18n:sync`/`i18n:fill` emit them),
 * so a leading `"key":` on a line reliably marks a top-level key. Keys are
 * compared by their raw source text — locale keys are plain dotted identifiers
 * with no escapes, so a repeat is byte-identical.
 * @param {string} content - the file's raw text
 * @returns {Array<{key: string, line: number, firstLine: number}>}
 */
export function findDuplicateKeys(content) {
  const keyRe = /^\s*"((?:\\.|[^"\\])*)"\s*:/;
  const firstSeen = new Map();
  const duplicates = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = keyRe.exec(lines[i]);
    if (!match) continue;
    const key = match[1];
    if (firstSeen.has(key)) {
      duplicates.push({ key, line: i + 1, firstLine: firstSeen.get(key) });
    } else {
      firstSeen.set(key, i + 1);
    }
  }
  return duplicates;
}
