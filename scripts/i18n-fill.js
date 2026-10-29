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
 * A translation is bound to the English it was reviewed against (see
 * scripts/lib/i18n-source-state.js). So the import for every locale but the
 * reference is a *reviewed package*, not a flat key → value map: each entry
 * names the fingerprint of the English it translates and of the translation it
 * replaces, and the whole package is refused if either moved since the export.
 * `--review` is the export side: the present translations that are not
 * current — never reviewed, or drifted since their review.
 *
 * Usage:
 *   node scripts/i18n-fill.js <locale>                       # what is missing, for a human
 *   node scripts/i18n-fill.js <locale> --json                # the same, as the translator hand-off
 *   node scripts/i18n-fill.js <locale> --review [--json]     # present translations awaiting review
 *   node scripts/i18n-fill.js --apply en                     # write missing EN keys from code fallbacks
 *   node scripts/i18n-fill.js --apply en <file.json>         # merge a flat EN key → value map
 *   node scripts/i18n-fill.js --apply <locale> <file.json>   # import a reviewed package
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
import {
  SOURCE_STATE_PATH,
  SOURCE_STATE_SCHEMA,
  classifyFreshness,
  hashText,
  readSourceState,
  referenceEnglish,
  referenceKey,
  writeSourceState,
} from './lib/i18n-source-state.js';
import { translationValueProblems } from './lib/i18n-values.js';

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
export async function enFileIndex(dir = i18nDir) {
  /** @type {Map<string, string>} */
  const byKey = new Map();
  /** @type {Map<string, Map<string, number>>} prefix -> module -> key count */
  const tally = new Map();
  let files;
  try {
    files = await fs.readdir(path.join(dir, REFERENCE_LOCALE));
  } catch {
    return { byKey, byPrefix: new Map() };
  }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    const comp = name.slice(0, -'.json'.length);
    const dict = await readComponent(REFERENCE_LOCALE, comp, dir);
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
async function writeComponent(locale, comp, dict, dir = i18nDir) {
  await writeJson(path.join(dir, locale, `${comp}.json`), dict);
}

/** Load one component file (missing file -> empty). */
async function readComponent(locale, comp, dir = i18nDir) {
  return (await readJson(path.join(dir, locale, `${comp}.json`))) || {};
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

/**
 * The present translations of `locale` that are not current, shaped as a
 * reviewed package the reviewer edits and hands back to `--apply`.
 *
 * Each entry carries the current English (`source`), the translation on disk
 * (`value`), why it is listed (`status`: `unreviewed`, `untracked`,
 * `source-changed`, `translation-changed`, comma-joined when both drifted) and
 * the two fingerprints the import will bind to: `sourceHash` of the English as
 * it is now and `previousTranslationHash` of the value as it is now. Reading
 * it stamps nothing. A translation whose English is gone (`source-missing`)
 * is not listed: there is nothing to review it against.
 *
 * @param {string} locale
 * @param {object} [opts]
 * @param {string} [opts.dir] - `client/i18n/`, injectable for tests
 * @param {string} [opts.statePath] - the sidecar, injectable for tests
 * @returns {Promise<{schema: number, locale: string, entries: Record<string, {status: string, source: string, sourceHash: string, previousTranslationHash: string, value: string}>}>}
 */
export async function reviewReportFor(
  locale,
  { dir = i18nDir, statePath = SOURCE_STATE_PATH } = {},
) {
  const reference = await loadLocale(dir, REFERENCE_LOCALE);
  const dict = await loadLocale(dir, locale);
  const state = await readSourceState(statePath);
  const { findings } = classifyFreshness({
    reference,
    translations: { [locale]: dict },
    state: { ...state, entries: { [locale]: state.entries[locale] || {} } },
  });
  /** @type {Map<string, string[]>} */
  const why = new Map();
  for (const f of findings) {
    if (
      !['untracked', 'source-changed', 'translation-changed'].includes(f.kind)
    )
      continue;
    why.set(f.key, [...(why.get(f.key) || []), f.kind]);
  }
  for (const [key, r] of Object.entries(state.entries[locale] || {}))
    if (
      r.status === 'unreviewed' &&
      !why.has(key) &&
      typeof dict[key] === 'string'
    )
      why.set(key, ['unreviewed']);

  const entries = {};
  for (const key of [...why.keys()].sort()) {
    const source = referenceEnglish(reference, key);
    entries[key] = {
      status: why.get(key).join(','),
      source,
      sourceHash: hashText(source),
      previousTranslationHash: hashText(dict[key]),
      value: dict[key],
    };
  }
  return { schema: SOURCE_STATE_SCHEMA, locale, entries };
}

/** The fields a reviewed-package entry may carry; the first three are required. */
const PACKAGE_ENTRY_FIELDS = [
  'sourceHash',
  'previousTranslationHash',
  'value',
  'source',
  'status',
];

/**
 * A reviewed package that may not be applied, with every reason at once so a
 * reviewer fixes the package in one round.
 */
export class ReviewPackageError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(
      `Refused the whole package, nothing written (${problems.length} problem(s)):\n` +
        problems.map((p) => `  ${p}`).join('\n'),
    );
    this.name = 'ReviewPackageError';
    this.problems = problems;
  }
}

/**
 * Import a reviewed package: every entry becomes the locale's value and is
 * recorded as `reviewed` against the English it names — or nothing is written.
 *
 * The package is `{schema: 1, locale, entries: {<key>: {sourceHash,
 * previousTranslationHash, value}}}`. `sourceHash` must fingerprint the English
 * as it is now and `previousTranslationHash` the translation as it is now (or
 * be `null` when there is none yet), so a package exported before an English
 * edit or a parallel translation edit is refused as a whole rather than
 * stamping a review onto text the reviewer never saw. Confirming an unchanged,
 * correct translation is a review too: send the same `value`. The informational
 * `source` and `status` that `--review` emits may stay in; `source`, if
 * present, must still be the English.
 *
 * Every entry is validated before the first write, against the same value
 * rules the suite gates (no blank value, matching `{var}` placeholders, no
 * Tier-2 carbon copy). Writes then go to the module file that already holds
 * the key, or for a new key the one `fileFor()` routes it to, and the sidecar
 * last; only the packaged keys' records change. Separate JSON files cannot be
 * written atomically: an I/O error after validation throws loudly, and the
 * working tree is the recovery (`git checkout client/i18n scripts/i18n-source-state.json`).
 *
 * @param {unknown} pkg - the parsed package
 * @param {object} [opts]
 * @param {string} [opts.locale] - the locale the CLI was asked to write
 * @param {string} [opts.dir] - `client/i18n/`, injectable for tests
 * @param {string} [opts.statePath] - the sidecar, injectable for tests
 * @returns {Promise<{locale: string, keys: string[], files: string[]}>}
 */
export async function applyReviewPackage(
  pkg,
  { locale: expectedLocale, dir = i18nDir, statePath = SOURCE_STATE_PATH } = {},
) {
  const problems = [];
  const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(pkg))
    throw new ReviewPackageError(['package must be an object']);
  const extra = Object.keys(pkg).filter(
    (k) => !['schema', 'locale', 'entries'].includes(k),
  );
  if (extra.length)
    problems.push(
      `unknown top-level field(s): ${extra.join(', ')} — a flat key → value ` +
        'map is no longer accepted; export a package with --review',
    );
  if (pkg.schema !== SOURCE_STATE_SCHEMA)
    problems.push(
      `"schema" is ${JSON.stringify(pkg.schema)}, expected ${SOURCE_STATE_SCHEMA}`,
    );
  const locale = pkg.locale;
  if (
    typeof locale !== 'string' ||
    !LOCALE_IDS.includes(locale) ||
    locale === REFERENCE_LOCALE
  )
    problems.push(
      `"locale" ${JSON.stringify(locale)} is not a translated locale`,
    );
  else if (expectedLocale && locale !== expectedLocale)
    problems.push(
      `package is for "${locale}", but --apply was asked to write "${expectedLocale}"`,
    );
  if (!isObject(pkg.entries) || !Object.keys(pkg.entries).length)
    problems.push('"entries" must be a non-empty object');
  if (problems.length) throw new ReviewPackageError(problems);

  const [reference, current, state] = await Promise.all([
    loadLocale(dir, REFERENCE_LOCALE),
    loadLocale(dir, locale),
    readSourceState(statePath),
  ]);

  for (const [key, entry] of Object.entries(pkg.entries)) {
    if (!isObject(entry)) {
      problems.push(`${key}: entry must be an object`);
      continue;
    }
    const unknown = Object.keys(entry).filter(
      (f) => !PACKAGE_ENTRY_FIELDS.includes(f),
    );
    if (unknown.length)
      problems.push(`${key}: unknown field(s) ${unknown.join(', ')}`);
    for (const f of ['sourceHash', 'previousTranslationHash', 'value'])
      if (!(f in entry)) problems.push(`${key}: missing "${f}"`);
    const english = referenceEnglish(reference, key);
    if (typeof english !== 'string') {
      problems.push(
        `${key}: not a key of ${REFERENCE_LOCALE}/ — nothing to translate`,
      );
      continue;
    }
    if (entry.sourceHash !== hashText(english))
      problems.push(
        `${key}: the English changed since the export (sourceHash)`,
      );
    if ('source' in entry && entry.source !== english)
      problems.push(`${key}: "source" is not the current English`);
    const onDisk =
      typeof current[key] === 'string' ? hashText(current[key]) : null;
    if (
      'previousTranslationHash' in entry &&
      entry.previousTranslationHash !== onDisk
    )
      problems.push(
        `${key}: the ${locale} translation changed since the export (previousTranslationHash)`,
      );
    for (const p of translationValueProblems(locale, entry.value, english))
      problems.push(`${key}: ${p}`);
  }
  if (problems.length) throw new ReviewPackageError(problems.sort());

  // Validated: route each key to the file that holds it now, or for a new key
  // to where en/ files the key it translates.
  const localeDir = path.join(dir, locale);
  /** @type {Map<string, Record<string, string>>} */
  const byFile = new Map();
  /** @type {Map<string, string>} key -> module that holds it now */
  const home = new Map();
  let names;
  try {
    names = (await fs.readdir(localeDir)).filter((n) => n.endsWith('.json'));
  } catch {
    names = []; // a locale with no directory yet: every key is new
  }
  for (const name of names.sort()) {
    const comp = name.slice(0, -'.json'.length);
    const dict = await readComponent(locale, comp, dir);
    byFile.set(comp, dict);
    for (const key of Object.keys(dict)) home.set(key, comp);
  }
  const enIndex = await enFileIndex(dir);
  const touched = new Set();
  for (const [key, entry] of Object.entries(pkg.entries)) {
    const comp = home.get(key) || fileFor(referenceKey(key), enIndex);
    if (!byFile.has(comp)) byFile.set(comp, {});
    byFile.get(comp)[key] = entry.value;
    touched.add(comp);
  }
  const entries = {
    ...state.entries,
    [locale]: { ...(state.entries[locale] || {}) },
  };
  for (const [key, entry] of Object.entries(pkg.entries))
    entries[locale][key] = {
      status: 'reviewed',
      sourceHash: entry.sourceHash,
      translationHash: hashText(entry.value),
    };

  for (const comp of [...touched].sort())
    await writeComponent(locale, comp, byFile.get(comp), dir);
  await writeSourceState({ ...state, entries }, statePath);
  return {
    locale,
    keys: Object.keys(pkg.entries).sort(),
    files: [...touched].sort(),
  };
}

const USAGE =
  'node scripts/i18n-fill.js <locale> [--json] [--review] | --apply <locale> [file.json]';

/**
 * The CLI half. Kept behind `isCli` so importing this module for `missingFor`
 * (tests, other tooling) neither parses arguments nor writes anything.
 * @returns {Promise<void>}
 */
async function main(argv) {
  const { flags, positional } = parseArgs(argv, {
    usage: USAGE,
    flags: ['--apply', '--json', '--review'],
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

  if (flags.has('--review')) {
    if (apply) fail('--review reads; --apply writes a reviewed package');
    if (file) fail(`Unexpected argument: ${file} — a file is for --apply`);
    if (locale === REFERENCE_LOCALE)
      fail(
        `${REFERENCE_LOCALE}/ is the source; there is nothing to review it against`,
      );
    const report = await reviewReportFor(locale);
    const keys = Object.keys(report.entries);
    if (flags.has('--json')) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      /** @type {Map<string, number>} */
      const byStatus = new Map();
      for (const e of Object.values(report.entries))
        byStatus.set(e.status, (byStatus.get(e.status) || 0) + 1);
      console.log(
        `${locale}/ has ${keys.length} present translation(s) awaiting review` +
          (byStatus.size
            ? ` (${[...byStatus].map(([s, n]) => `${n} ${s}`).join(', ')})`
            : '') +
          '.',
      );
      for (const key of keys.slice(0, 20))
        console.log(`  ${key}  [${report.entries[key].status}]`);
      if (keys.length > 20) console.log(`  … ${keys.length - 20} more`);
      if (keys.length)
        console.log(
          '\nRe-run with --json for the package; edit "value", keep the rows you ' +
            `reviewed, then: node scripts/i18n-fill.js --apply ${locale} <file.json>`,
        );
    }
    return;
  }

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

  if (file && locale !== REFERENCE_LOCALE) {
    let pkg;
    try {
      pkg = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      fail(`Cannot read ${file}: ${err.message}`);
    }
    try {
      const done = await applyReviewPackage(pkg, { locale });
      console.log(
        `Reviewed ${done.keys.length} ${locale}/ translation(s) across ` +
          `${done.files.length} file(s); recorded in scripts/i18n-source-state.json`,
      );
    } catch (err) {
      if (!(err instanceof ReviewPackageError)) throw err;
      console.error(err.message);
      process.exit(1);
    }
    return;
  }

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
