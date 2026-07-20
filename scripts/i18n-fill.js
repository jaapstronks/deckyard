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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(repoRoot, 'client');
const i18nDir = path.join(clientDir, 'i18n');

/**
 * Which component file a key belongs in, derived from where its prefix already
 * lives in en/. Falls back to `common` for genuinely new prefixes.
 */
const PREFIX_TO_FILE = {
  access: 'common', activity: 'presenter', admin: 'settings', analytics: 'common',
  app: 'common', appearance: 'common', comments: 'editor', common: 'common',
  cookies: 'common', dashboard: 'common', dataSource: 'editor', editor: 'editor',
  export: 'common', follow: 'follow', fonts: 'settings', forgotPassword: 'auth',
  imageLibrary: 'list', imagekit: 'settings', language: 'common', leadCapture: 'common',
  list: 'list', login: 'auth', magicLogin: 'auth', mediaLibrary: 'list',
  mentions: 'editor', moderate: 'share', notes: 'presenter', notesJoin: 'presenter',
  notifications: 'common', presentWindow: 'presenter', presenter: 'presenter',
  qa: 'editor', resetPassword: 'auth', settings: 'settings', share: 'share',
  shareViewer: 'share', shortcuts: 'common', slideLibrary: 'list',
  slideType: 'slide-types', stockMedia: 'common', subscription: 'editor',
  tags: 'list', userAutocomplete: 'common', viewer: 'common', visibility: 'editor',
};

/** @param {string} key @returns {string} component file basename */
function fileFor(key) {
  return PREFIX_TO_FILE[key.split('.')[0]] || 'common';
}

/** Write a dict back to disk with stable key ordering. */
async function writeComponent(locale, comp, dict) {
  const sorted = Object.fromEntries(Object.keys(dict).sort().map((k) => [k, dict[k]]));
  const file = path.join(i18nDir, locale, `${comp}.json`);
  await fs.writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/** Load one component file (missing file -> empty). */
async function readComponent(locale, comp) {
  try {
    return JSON.parse(await fs.readFile(path.join(i18nDir, locale, `${comp}.json`), 'utf8'));
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
  for (const [key, value] of Object.entries(entries)) {
    const comp = fileFor(key);
    if (!byFile.has(comp)) byFile.set(comp, await readComponent(locale, comp));
    byFile.get(comp)[key] = value;
  }
  for (const [comp, dict] of byFile) await writeComponent(locale, comp, dict);
  return byFile.size;
}

async function missingFor(locale) {
  const used = await extractUsedKeys(clientDir);
  const dict = await loadLocale(i18nDir, locale);
  /** @type {Record<string, string>} */
  const missing = {};
  for (const [key, { fallback }] of used) {
    if (isDynamicKey(key)) continue;
    if (typeof dict[key] === 'string') continue;
    if (key.startsWith('follow.')) continue; // scoped loader, not the global dict
    if (fallback == null) continue; // no English source to work from
    missing[key] = fallback;
  }
  return missing;
}

const [mode, ...rest] = process.argv.slice(2);

if (mode === '--report') {
  const locale = rest[0];
  if (!locale) throw new Error('--report needs a locale');
  process.stdout.write(`${JSON.stringify(await missingFor(locale), null, 2)}\n`);
} else if (mode === '--apply') {
  const [locale, file] = rest;
  if (!locale || !file) throw new Error('--apply needs <locale> <file.json>');
  const entries = JSON.parse(await fs.readFile(file, 'utf8'));
  const n = await mergeIntoLocale(locale, entries);
  console.log(`Merged ${Object.keys(entries).length} keys into ${n} ${locale}/ file(s)`);
} else if (mode === 'en') {
  const missing = await missingFor('en');
  const n = await mergeIntoLocale('en', missing);
  console.log(`Wrote ${Object.keys(missing).length} EN keys across ${n} file(s)`);
} else {
  console.error('Usage: i18n-fill.js en | --report <locale> | --apply <locale> <file.json>');
  process.exit(1);
}
