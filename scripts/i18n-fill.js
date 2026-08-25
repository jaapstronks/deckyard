#!/usr/bin/env node
/**
 * i18n fill helper.
 *
 * Every t() call carries an English fallback and every slide-type field
 * declaration carries its English label, so English can be materialized
 * mechanically: the code *is* the English string. Other locales need real
 * translation, so this script only reports their gaps and merges translations
 * back in.
 *
 * Reading is the default, `--apply` writes, `--json` is machine output — the
 * vocabulary every i18n script shares (scripts/lib/cli-args.js). `--report`
 * was this script's private word for the read half and a bare `en` was its
 * private word for a write; both are gone.
 *
 * Usage:
 *   node scripts/i18n-fill.js <locale>                       # what is missing, for a human
 *   node scripts/i18n-fill.js <locale> --json                # the same, as the translator hand-off
 *   node scripts/i18n-fill.js --apply en                     # write missing EN keys from code fallbacks
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
import { parseArgs } from './lib/cli-args.js';
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
 * Every key a locale still needs, as key -> English source string.
 *
 * Three sources, because no one of them is complete:
 *
 *  1. the static `t()` call sites, which carry the English fallback;
 *  2. `en/` itself, which is the settled English wording for every key it
 *     already holds; and
 *  3. the **slide-type registry declarations** (`registryEnglish`), which are
 *     where a field/option/type writes its key down in the first place — as a
 *     `labelKey`/`label` pair, or implicitly through the
 *     `slideType.<type>.field.…` convention.
 *
 * Source 3 is the one that closes the loop, and it took three bugs to get here.
 * Source 1 alone made the tool answer "0 missing" for a locale that was 272
 * keys short, because `slideType.*`, `editor.textStyle.*`,
 * `editor.layoutVariant.*` and `editor.inline.add*`/`remove*` are assembled
 * from template literals and `extractUsedKeys` cannot see them (B136). Adding
 * source 2 fixed that for every locale *except* the reference — materializing
 * `en/` from `en/` is circular — so `en` got a narrow substitute: keys some
 * *other* locale already translated, valued from the registry (B138). That
 * substitute only ever proposed keys a locale had already heard of, which is
 * how eighteen `editor.slideField.*` keys declared in `shared/slide-types/`
 * lived in no locale at all while this script reported "missing 0" (B166/B168).
 *
 * Reading the registry directly subsumes it: a declared key is proposed the
 * moment it is declared, for every locale, whether or not anything else has
 * ever seen it. The registry is also the *authority* on the English for the
 * keys it declares, so it is folded in last; `en/` still wins for any locale
 * being filled from the reference (`en[key] ?? english`).
 *
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
  for (const [key, english] of registryEnglish()) want(key, en[key] ?? english);
  return missing;
}

const USAGE =
  'node scripts/i18n-fill.js <locale> [--json] | --apply <locale> [file.json]';

/**
 * The CLI half. Kept behind `isCli` so importing this module for `missingFor`
 * (tests, other tooling) neither parses arguments nor writes anything.
 * @returns {Promise<void>}
 */
async function main(argv) {
  const { flags, positional } = parseArgs(argv, {
    usage: USAGE,
    flags: ['--apply', '--json'],
    maxPositional: 2,
  });
  const apply = flags.has('--apply');
  const [locale, file] = positional;

  const fail = (message) => {
    console.error(message);
    console.error(`Usage: ${USAGE}`);
    process.exit(1);
  };

  if (!locale) fail('Which locale?');
  if (!LOCALE_IDS.includes(locale))
    fail(`Not a shipped locale: ${locale} (see client/i18n/manifest.json)`);

  if (!apply) {
    if (file) fail(`Unexpected argument: ${file} — a file is for --apply`);
    const missing = await missingFor(locale);
    if (flags.has('--json')) {
      process.stdout.write(`${JSON.stringify(missing, null, 2)}\n`);
    } else {
      const keys = Object.keys(missing);
      console.log(
        `${locale}/ is missing ${keys.length} key(s) that have an English source.`,
      );
      for (const key of keys.slice(0, 20)) console.log(`  ${key}`);
      if (keys.length > 20) console.log(`  … ${keys.length - 20} more`);
      if (keys.length)
        console.log(`\nRe-run with --json for the full set to translate.`);
    }
    return;
  }

  if (flags.has('--json')) fail('--json describes the report, not --apply');

  if (file) {
    const entries = JSON.parse(await fs.readFile(file, 'utf8'));
    const n = await mergeIntoLocale(locale, entries);
    console.log(
      `Merged ${Object.keys(entries).length} keys into ${n} ${locale}/ file(s)`,
    );
    return;
  }

  // No file: the only locale that can be written from the code itself is the
  // reference one, whose English *is* the t() fallbacks. Every other locale
  // needs a translation to merge.
  if (locale !== REFERENCE_LOCALE)
    fail(
      `--apply ${locale} needs a file: only ${REFERENCE_LOCALE}/ can be ` +
        'materialized from the code fallbacks.',
    );
  const missing = await missingFor(locale);
  const n = await mergeIntoLocale(locale, missing);
  console.log(
    `Wrote ${Object.keys(missing).length} ${locale.toUpperCase()} keys across ${n} file(s)`,
  );
}

if (isCli(import.meta.url)) await main(process.argv.slice(2));
