#!/usr/bin/env node
/**
 * i18n fill helper.
 *
 * Every t() call carries an English fallback, so English can be materialized
 * mechanically: the fallback *is* the English string. Other locales need real
 * translation, so this script only reports their gaps and merges translations
 * back in.
 *
 * Usage:
 *   node scripts/i18n-fill.js en                 # write missing EN keys from code fallbacks
 *   node scripts/i18n-fill.js --report <locale>  # emit missing keys as JSON on stdout
 *   node scripts/i18n-fill.js --apply <locale> <file.json>   # merge translations in
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractUsedKeys, loadLocale, isDynamicKey } from './i18n-keys.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const clientDir = path.join(repoRoot, 'client');
const i18nDir = path.join(clientDir, 'i18n');

/**
 * Fallback routing for a key `en/` has never seen, by prefix. `en/` itself is
 * the primary answer (see `fileFor`); this table only decides where a brand-new
 * prefix lands, and `common` catches the rest.
 *
 * It used to be the *only* answer, which is how locale files drifted apart:
 * `analytics.*` routes here to `common`, while `en/` keeps those keys in
 * `editor.json`, so every applied translation landed in a different file than
 * its English source (B137).
 */
const PREFIX_TO_FILE = {
  access: 'common',
  activity: 'presenter',
  admin: 'settings',
  analytics: 'common',
  app: 'common',
  appearance: 'common',
  comments: 'editor',
  common: 'common',
  cookies: 'common',
  dashboard: 'common',
  dataSource: 'editor',
  editor: 'editor',
  export: 'common',
  follow: 'follow',
  fonts: 'settings',
  forgotPassword: 'auth',
  imageLibrary: 'list',
  imagekit: 'settings',
  language: 'common',
  list: 'list',
  login: 'auth',
  magicLogin: 'auth',
  mediaLibrary: 'list',
  mentions: 'editor',
  moderate: 'share',
  notes: 'presenter',
  notesJoin: 'presenter',
  notifications: 'common',
  presentWindow: 'presenter',
  presenter: 'presenter',
  qa: 'editor',
  resetPassword: 'auth',
  settings: 'settings',
  share: 'share',
  shareViewer: 'share',
  shortcuts: 'common',
  slideLibrary: 'list',
  slideType: 'slide-types',
  stockMedia: 'common',
  subscription: 'editor',
  tags: 'list',
  userAutocomplete: 'common',
  viewer: 'common',
  visibility: 'editor',
};

/**
 * key -> component basename, as `en/` files them. Built once per run; `en/` is
 * the reference locale, so "where the English string lives" is the only
 * definition of a key's home that cannot drift.
 * @returns {Promise<Map<string, string>>}
 */
async function enFileIndex() {
  /** @type {Map<string, string>} */
  const index = new Map();
  let files;
  try {
    files = await fs.readdir(path.join(i18nDir, 'en'));
  } catch {
    return index;
  }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const comp = name.slice(0, -'.json'.length);
    const dict = await readComponent('en', comp);
    for (const key of Object.keys(dict)) index.set(key, comp);
  }
  return index;
}

/**
 * @param {string} key
 * @param {Map<string, string>} enIndex - key -> component, from `en/`
 * @returns {string} component file basename
 */
function fileFor(key, enIndex) {
  return enIndex.get(key) || PREFIX_TO_FILE[key.split('.')[0]] || 'common';
}

/** Write a dict back to disk with stable key ordering. */
async function writeComponent(locale, comp, dict) {
  const sorted = Object.fromEntries(
    Object.keys(dict)
      .sort()
      .map((k) => [k, dict[k]]),
  );
  const file = path.join(i18nDir, locale, `${comp}.json`);
  await fs.writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/** Load one component file (missing file -> empty). */
async function readComponent(locale, comp) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(i18nDir, locale, `${comp}.json`), 'utf8'),
    );
  } catch {
    return {};
  }
}

/**
 * Merge a flat key->value map into the right component files for a locale.
 * @param {string} locale
 * @param {Record<string,string>} entries
 */
async function mergeIntoLocale(locale, entries) {
  /** @type {Map<string, Record<string,string>>} */
  const byFile = new Map();
  const enIndex = await enFileIndex();
  for (const [key, value] of Object.entries(entries)) {
    const comp = fileFor(key, enIndex);
    if (!byFile.has(comp)) byFile.set(comp, await readComponent(locale, comp));
    byFile.get(comp)[key] = value;
  }
  for (const [comp, dict] of byFile) await writeComponent(locale, comp, dict);
  return byFile.size;
}

/**
 * Every key a locale still needs, as key -> English source string.
 *
 * Two sources, because neither is complete on its own:
 *
 *  1. the static `t()` call sites, which carry the English fallback; and
 *  2. `en/` itself, which is the settled English wording *and* the only place
 *     the runtime-built families are written down at all. `slideType.*`,
 *     `editor.textStyle.*`, `editor.layoutVariant.*` and
 *     `editor.inline.add*`/`remove*` are assembled from template literals, so
 *     `extractUsedKeys` cannot see them — yet each one has a fixed English
 *     string in `en/` and is therefore perfectly translatable. Reporting only
 *     source 1 made the tool answer "0 missing" for a locale that was 272 keys
 *     short (B136).
 *
 * For the `en` target there is nothing to seed from, so only source 1 applies:
 * materializing en/ *from* en/ would be circular.
 *
 * @param {string} locale
 * @returns {Promise<Record<string, string>>}
 */
export async function missingFor(locale) {
  const used = await extractUsedKeys(clientDir);
  const dict = await loadLocale(i18nDir, locale);
  const en = locale === 'en' ? {} : await loadLocale(i18nDir, 'en');
  /** @type {Record<string, string>} */
  const missing = {};
  /** @param {string} key @param {unknown} english */
  const want = (key, english) => {
    if (key.startsWith('follow.')) return; // scoped loader, not the global dict
    if (typeof dict[key] === 'string') return;
    if (typeof english !== 'string') return; // no English source to work from
    missing[key] = english;
  };
  for (const [key, { fallback }] of used) {
    // A runtime-built key is still translatable once en/ has settled on a
    // string for it; skip it only while en/ has nothing to translate from.
    if (isDynamicKey(key) && typeof en[key] !== 'string') continue;
    want(key, en[key] ?? fallback);
  }
  for (const [key, english] of Object.entries(en)) want(key, english);
  return missing;
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const [mode, ...rest] = isCli ? process.argv.slice(2) : [];

if (mode === '--report') {
  const locale = rest[0];
  if (!locale) throw new Error('--report needs a locale');
  process.stdout.write(
    `${JSON.stringify(await missingFor(locale), null, 2)}\n`,
  );
} else if (mode === '--apply') {
  const [locale, file] = rest;
  if (!locale || !file) throw new Error('--apply needs <locale> <file.json>');
  const entries = JSON.parse(await fs.readFile(file, 'utf8'));
  const n = await mergeIntoLocale(locale, entries);
  console.log(
    `Merged ${Object.keys(entries).length} keys into ${n} ${locale}/ file(s)`,
  );
} else if (mode === 'en') {
  const missing = await missingFor('en');
  const n = await mergeIntoLocale('en', missing);
  console.log(
    `Wrote ${Object.keys(missing).length} EN keys across ${n} file(s)`,
  );
} else if (isCli) {
  console.error(
    'Usage: i18n-fill.js en | --report <locale> | --apply <locale> <file.json>',
  );
  process.exit(1);
}
