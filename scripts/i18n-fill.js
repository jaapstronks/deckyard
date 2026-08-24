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

import { CORE_SLIDE_TYPE_DEFS } from '../shared/slide-types/registry.js';
import { SLIDE_TYPE_DESCRIPTION } from '../shared/slide-types/authoring-companions.js';
import { extractUsedKeys, isDynamicKey } from './lib/i18n-keys.js';
import {
  CLIENT_DIR as clientDir,
  I18N_DIR as i18nDir,
  loadLocale,
  readJson,
  writeJson,
} from './lib/i18n-fs.js';
import { isCli } from './lib/is-cli.js';
import { slideTypeUiStrings } from './lib/slide-type-i18n-keys.js';
import { LOCALE_IDS, REFERENCE_LOCALE } from './lib/i18n-locales.js';

/**
 * @typedef {object} EnIndex
 * @property {Map<string, string>} byKey     key -> the module `en/` files it in
 * @property {Map<string, string>} byPrefix  first key segment -> the module
 *   holding most of `en/`'s keys under it
 */

/**
 * Where `en/` files things, read once per run.
 *
 * `en/` is the reference locale, so "where the English string lives" is the
 * only definition of a key's home that cannot drift — for a key that exists.
 * For a key `en/` has never seen there has to be a second answer, and until
 * B147 that was `PREFIX_TO_FILE`, 44 hand-kept lines. It had already drifted:
 * `organization` was missing, so a brand-new `organization.*` key routed to
 * `common` while `en/` filed its 81 existing organization keys in
 * `settings.json` — the exact B137 failure the top of `fileFor` was added to
 * fix, one level up. Three of its rows (`cookies`, `export`, `shareViewer`)
 * named prefixes with no `en/` key at all.
 *
 * So the second answer is derived from the same pass as the first: the module
 * where most of `en/`'s keys under this prefix already live. Measured against
 * the table it replaced, that reproduces 41 of the 44 rows exactly, drops the
 * three dead ones, and adds the seven prefixes the table had fallen behind on.
 * A prefix genuinely split across modules (`analytics` is 75 `common` to 6
 * `editor`) resolves to the majority, ties by module name so a run is
 * deterministic.
 *
 * @returns {Promise<EnIndex>}
 */
export async function enFileIndex() {
  /** @type {Map<string, string>} */
  const byKey = new Map();
  /** @type {Map<string, Map<string, number>>} prefix -> module -> key count */
  const tally = new Map();
  let files;
  try {
    files = await fs.readdir(path.join(i18nDir, 'en'));
  } catch {
    return { byKey, byPrefix: new Map() };
  }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const comp = name.slice(0, -'.json'.length);
    const dict = await readComponent('en', comp);
    for (const key of Object.keys(dict)) {
      byKey.set(key, comp);
      const prefix = key.split('.')[0];
      if (!tally.has(prefix)) tally.set(prefix, new Map());
      const counts = tally.get(prefix);
      counts.set(comp, (counts.get(comp) || 0) + 1);
    }
  }
  /** @type {Map<string, string>} */
  const byPrefix = new Map();
  for (const [prefix, counts] of tally) {
    const [winner] = [...counts].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    byPrefix.set(prefix, winner);
  }
  return { byKey, byPrefix };
}

/**
 * Which module file a key belongs in.
 *
 * `en/` answers directly for a key it already holds; for a new key it answers
 * by prefix (see `enFileIndex`). `common` catches a prefix `en/` has never seen
 * in any form — a genuinely new namespace, which lands somewhere valid and gets
 * a real home the moment `en/` has one key under it.
 *
 * @param {string} key
 * @param {EnIndex} enIndex
 * @returns {string} component file basename
 */
export function fileFor(key, { byKey, byPrefix }) {
  return byKey.get(key) || byPrefix.get(key.split('.')[0]) || 'common';
}

/** Write a dict back to disk with stable key ordering. */
async function writeComponent(locale, comp, dict) {
  await writeJson(path.join(i18nDir, locale, `${comp}.json`), dict);
}

/** Load one component file (missing file -> empty). */
async function readComponent(locale, comp) {
  return (await readJson(path.join(i18nDir, locale, `${comp}.json`))) || {};
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
 * The English a runtime-built key family carries in code, key -> string.
 *
 * `extractUsedKeys` only sees `t('literal', 'fallback')`; the picker and the
 * field renderer build their keys from template literals and resolve the
 * English from the registry instead — `slideTypeDescription()` for a type's
 * picker blurb, the field/option declarations for `slideType.*`. So for these
 * families the registry *is* the call-site fallback, and it is the only place
 * `en/` can be materialized from.
 *
 * Read from **core** definitions (`CORE_SLIDE_TYPE_DEFS`, `SLIDE_TYPE_DESCRIPTION`),
 * never the merged registry: `en/` is a tracked artifact, so a fork type
 * installed in `custom/slide-types/` must not be able to change what this
 * command writes — the same rule the generated reference docs follow.
 *
 * @returns {Map<string, string>} key -> English string
 */
function registryEnglish() {
  const out = slideTypeUiStrings(CORE_SLIDE_TYPE_DEFS);
  for (const [type, description] of Object.entries(SLIDE_TYPE_DESCRIPTION))
    out.set(`editor.slideTypeDesc.${type}`, description);
  return out;
}

/**
 * Every key some locale translates, across all of them.
 *
 * `en/` is the reference: it decides a key's wording *and* (since B137) which
 * module file it lives in. A key a locale holds while `en/` does not is
 * therefore reference drift — either English is missing a string it owns, or
 * the key is dead and the locale is carrying a translation of nothing. Both
 * want to be visible, so the `en` target seeds from this set.
 *
 * @returns {Promise<Set<string>>}
 */
async function keysHeldByAnyLocale() {
  const keys = new Set();
  for (const locale of LOCALE_IDS) {
    if (locale === REFERENCE_LOCALE) continue;
    for (const key of Object.keys(await loadLocale(i18nDir, locale)))
      keys.add(key);
  }
  return keys;
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
 * The `en` target cannot use source 2 — materializing en/ *from* en/ would be
 * circular — so it gets a third instead: **every key another locale already
 * translates**, valued from the registry (`registryEnglish`). That is what
 * makes the reference a superset by construction. Without it, a runtime-built
 * key could live in a locale forever while `en/` never learned it existed, and
 * `i18n-fill.js en` had no way to add it — 62 keys sat in `nl/` alone (B138).
 * A key with no English source anywhere is deliberately *not* invented here: it
 * is dead, and `tests/i18n-coverage.test.js` names it so it can be deleted.
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
  if (locale === 'en') {
    const registry = registryEnglish();
    for (const key of await keysHeldByAnyLocale()) want(key, registry.get(key));
  }
  return missing;
}

const runAsCli = isCli(import.meta.url);

const [mode, ...rest] = runAsCli ? process.argv.slice(2) : [];

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
} else if (runAsCli) {
  console.error(
    'Usage: i18n-fill.js en | --report <locale> | --apply <locale> <file.json>',
  );
  process.exit(1);
}
