#!/usr/bin/env node
/**
 * i18n Sync Script
 *
 * Synchronizes all language files with English (reference): prunes
 * `slideType.*` keys the registry no longer produces, then strips the Tier-2
 * values that are byte-identical to their English ones.
 *
 * The strip is the second half because of D73: **an untranslated key is
 * absent.** `t(key, fallback)` renders the call-site fallback when a locale
 * lacks a key, and check 5 of tests/i18n-coverage.test.js pins every fallback
 * on the `en/` value — so a missing key renders exactly what an English copy
 * of it would have rendered, minus the duplicated data. This script used to
 * *write* those copies (the fill half, ~1.8k keys a round); they lied to two
 * instruments. The anchor gate (B148) read a placeholder as a second spelling
 * of a concept the locale translates elsewhere, and `missingFor()` in
 * i18n-fill.js counted a filled key as translated, so the translator gap
 * report said zero for a locale with hundreds of holes. One canonical form for
 * "not translated yet", and it is absence.
 *
 * Scope comes from `client/i18n/manifest.json` by way of `i18n-locales.js`:
 * both halves sweep every module, the prune over every locale and the strip
 * over the Tier-2 ones. `nl` is Tier-1 — presence is mandatory there, and a
 * value that happens to equal the English can be legitimate Dutch ("Export",
 * "Status"). Nothing here keeps its own spelling of those lists — see
 * i18n-locales.js for what the four hand-kept ones cost.
 *
 * Split in two halves on purpose. `planSync()` only reads — it returns the
 * complete list of edits the run would make — and `applyPlan()` is the only
 * thing that touches disk. The default run is the first half, so "what would
 * this do?" is answerable without a working copy to clean up afterwards.
 *
 * Reading is the default and `--apply` writes — the vocabulary every i18n
 * script shares, see scripts/lib/cli-args.js. This script used to invert it
 * (write by default, `--dry-run` to hold back), which meant the safe run was
 * the one you had to remember.
 *
 * Usage:
 *   node scripts/i18n-sync.js              # report the plan, write nothing
 *   node scripts/i18n-sync.js --apply      # prune + strip, writing to disk
 */

import path from 'node:path';

import { SLIDE_TYPES } from '../shared/slide-types.js';
import { slideTypeUiKeys } from './lib/slide-type-i18n-keys.js';
import { I18N_DIR, readJson, writeJson } from './lib/i18n-fs.js';
import { isCli } from './lib/is-cli.js';
import { parseArgs } from './lib/cli-args.js';
import {
  LOCALE_IDS,
  MODULES,
  REFERENCE_LOCALE,
  TIER_2,
} from './lib/i18n-locales.js';

/** How many key names a plan prints per file before summarizing the rest. */
const DRY_RUN_KEY_SAMPLE = 10;

/**
 * The set of `slideType.*` keys the live registry currently produces — the
 * authority the prune below measures every locale against.
 *
 * Derived from the whole of `SLIDE_TYPES`, fork types **included** — and since
 * B94 `slideTypeUiKeys()` cannot be asked for anything narrower: the skip-set
 * the retired `i18n-extract` used (a fork's strings must not leak into a shared
 * extraction template) is gone with it. The prune has the opposite duty — a fork
 * type's keys are as live as a core type's, so narrowing this set to core would
 * make the prune silently delete a fork's own translations, and delete a core
 * type's keys outright once a fork registers over its name with `override:
 * true`. That asymmetry was the #499 regression; it is now structurally
 * impossible at this seam, and `tests/fork-slide-type-derivations.test.js` still
 * pins the result against a file-based fork type loaded from `custom/slide-types/`,
 * which is the only place it is observable.
 *
 * Kept as its own export (not inlined into the prune) so that test can assert on
 * the exact set the prune uses, rather than a re-derivation that could drift.
 *
 * @returns {Set<string>} every valid `slideType.*` key, core and fork alike
 */
export function liveSlideTypeI18nKeys() {
  return slideTypeUiKeys(SLIDE_TYPES);
}

/**
 * @typedef {object} SyncFileEdit
 * @property {string} locale       locale directory the file lives in
 * @property {string} module       module basename, without `.json`
 * @property {string} filePath     absolute path to the file
 * @property {string[]} pruned     `slideType.*` keys the registry no longer produces
 * @property {string[]} stripped   keys whose value was a carbon copy of English
 * @property {object} data         the file's contents with both edits applied
 */

/**
 * @typedef {object} SyncPlan
 * @property {SyncFileEdit[]} edits  one entry per file that would change
 * @property {number} totalPruned    keys removed across all files
 * @property {number} totalStripped  carbon copies removed across all files
 * @property {string[]} skippedModules modules with no reference to compare against
 * @property {SyncScope} scope       the locale/module matrix the plan covers
 */

/**
 * @typedef {object} SyncScope
 * @property {string[]} locales      locales the prune sweeps
 * @property {string[]} modules      modules both halves sweep
 * @property {string[]} stripLocales locales the strip removes carbon copies from
 * @property {string} reference      locale a carbon copy is measured against
 */

/**
 * Compute every edit a sync would make, without touching disk.
 *
 * Prune before strip, and both in memory: the strip compares a locale's value
 * against English, so it has to read the English the prune leaves behind — a
 * dead key deleted from `en/` but still measured against its old value would
 * survive the strip in every locale.
 *
 * **The prune** removes `slideType.*` keys the registry no longer produces.
 * Nothing else deletes them: `i18n-fill` only ever adds, and the audit's orphan
 * check skips the whole `slideType.` family as runtime-built. So a field, option or type that
 * leaves the registry strands its translations in every locale forever. The
 * registry is the authority on which keys are real; anything under `slideType.`
 * that it does not generate is dead — including in English, which drifts the
 * same way. Scoped to the `slideType.` namespace on purpose: keys like
 * `editor.slideTypeDesc.<type>` are runtime-built fallbacks a locale may hold
 * without English (the picker resolves them against the authoring default), so a
 * blanket "not in English" prune would delete live translations. The valid set
 * is `liveSlideTypeI18nKeys()`, which keeps fork types — see there for why
 * excluding them would silently delete a fork's translations (#499).
 *
 * **The strip** removes, from every Tier-2 locale, each key whose value is
 * byte-identical to the English one — a carbon copy says "not translated yet"
 * in the one form the tooling misreads, and absence says it in the form the
 * runtime already handles (D73). It sweeps every module, like the prune: a
 * carbon copy is dead weight wherever it sits, `follow.json` included, even
 * though no loader reaches a Tier-2 `deck` module. Only the locale axis is
 * narrowed, and `TIER_2` is where that narrowing is stated.
 *
 * @returns {Promise<SyncPlan>} the edits, keyed per file
 */
export async function planSync() {
  const valid = liveSlideTypeI18nKeys();
  /** @type {Map<string, SyncFileEdit>} */
  const edits = new Map();
  /** locale/module → contents as they stand after the prune */
  const loaded = new Map();
  const skippedModules = [];

  const editFor = (locale, moduleName, filePath, data) => {
    const id = `${locale}/${moduleName}`;
    let edit = edits.get(id);
    if (!edit) {
      edit = {
        locale,
        module: moduleName,
        filePath,
        pruned: [],
        stripped: [],
        data,
      };
      edits.set(id, edit);
    }
    return edit;
  };

  // Prune pass — every locale × every module, the reference included. A dead
  // `slideType.*` key is dead wherever it sits, `follow.json` and the reference
  // locale's own files included, so this half is not narrowed by loader.
  for (const locale of LOCALE_IDS) {
    for (const moduleName of MODULES) {
      const filePath = path.join(I18N_DIR, locale, `${moduleName}.json`);
      const data = await readJson(filePath);
      if (!data) continue;
      loaded.set(`${locale}/${moduleName}`, data);

      const dead = Object.keys(data).filter(
        (k) => k.startsWith('slideType.') && !valid.has(k),
      );
      if (dead.length === 0) continue;

      for (const k of dead) delete data[k];
      editFor(locale, moduleName, filePath, data).pruned.push(...dead);
    }
  }

  // Strip pass — the carbon copies of the reference (post-prune) out of every
  // Tier-2 locale. Narrowed on the locale axis only: `nl` is Tier-1, where
  // presence is mandatory and a value equal to the English can be real Dutch.
  for (const moduleName of MODULES) {
    const referenceData = loaded.get(`${REFERENCE_LOCALE}/${moduleName}`);
    if (!referenceData) {
      skippedModules.push(moduleName);
      continue;
    }

    for (const locale of TIER_2) {
      const id = `${locale}/${moduleName}`;
      const data = loaded.get(id);
      if (!data) continue;

      const copies = Object.keys(data).filter(
        (k) => data[k] === referenceData[k],
      );
      if (copies.length === 0) continue;

      const filePath = path.join(I18N_DIR, locale, `${moduleName}.json`);
      for (const k of copies) delete data[k];
      editFor(locale, moduleName, filePath, data).stripped.push(...copies);
    }
  }

  const list = [...edits.values()];
  return {
    edits: list,
    totalPruned: list.reduce((n, e) => n + e.pruned.length, 0),
    totalStripped: list.reduce((n, e) => n + e.stripped.length, 0),
    skippedModules,
    // Reported, not just used: the scope is the whole point of the manifest
    // being the source, so a plan states it and the tests assert on it
    // rather than re-deriving what the loops above happened to iterate.
    scope: {
      locales: [...LOCALE_IDS],
      modules: [...MODULES],
      stripLocales: [...TIER_2],
      reference: REFERENCE_LOCALE,
    },
  };
}

/**
 * Write a plan's edits to disk.
 *
 * Every file is written sorted. This used to be conditional — a prune kept the
 * file's existing order so the diff would read as a clean set of removed lines
 * rather than a whole-file re-sort — because en/it/pl/fi were not stored in
 * this script's order. Since B138 they are: `tests/i18n-locales.test.js` fails
 * on any locale file whose keys are unsorted, so sorting a pruned file moves
 * nothing and the branch guarded a case that can no longer exist.
 *
 * Only files that already exist are written: both halves are deletions, so a
 * plan never names a path that is not on disk.
 *
 * @param {SyncPlan} plan
 * @returns {Promise<void>}
 */
export async function applyPlan(plan) {
  for (const edit of plan.edits) {
    await writeJson(edit.filePath, edit.data);
  }
}

function formatKeys(keys) {
  const shown = keys.slice(0, DRY_RUN_KEY_SAMPLE);
  const rest = keys.length - shown.length;
  return (
    shown.map((k) => `      ${k}`).join('\n') +
    (rest > 0 ? `\n      … ${rest} more` : '')
  );
}

function reportPlan(plan, { apply }) {
  const { locales, modules, stripLocales, reference } = plan.scope;
  console.log(
    `Scope (client/i18n/manifest.json): pruning ${locales.length} locale(s) × ` +
      `${modules.length} module(s); stripping ${stripLocales.length} Tier-2 ` +
      `locale(s) × ${modules.length} module(s) against ${reference}.\n`,
  );

  for (const edit of plan.edits) {
    const parts = [];
    if (edit.pruned.length)
      parts.push(`-${edit.pruned.length} orphaned slideType key(s)`);
    if (edit.stripped.length)
      parts.push(`-${edit.stripped.length} carbon copy of ${reference}`);
    console.log(`${edit.locale}/${edit.module}.json: ${parts.join(', ')}`);
    if (!apply && edit.pruned.length) {
      console.log('    pruned:');
      console.log(formatKeys(edit.pruned));
    }
    if (!apply && edit.stripped.length) {
      console.log('    stripped:');
      console.log(formatKeys(edit.stripped));
    }
  }

  for (const moduleName of plan.skippedModules) {
    console.log(`Skipping ${moduleName}: no English source`);
  }

  console.log(
    `\n${plan.edits.length} file(s) ${apply ? 'changed' : 'would change'}: ` +
      `${plan.totalPruned} orphaned slideType key(s) pruned, ` +
      `${plan.totalStripped} carbon copy of ${reference} stripped.`,
  );
}

async function main(argv = process.argv.slice(2)) {
  const { flags } = parseArgs(argv, {
    usage: 'node scripts/i18n-sync.js [--apply]',
    flags: ['--apply'],
  });
  const apply = flags.has('--apply');

  console.log(
    apply
      ? 'i18n Sync - Prune orphaned slide-type keys, then strip Tier-2 carbon copies of English\n'
      : 'i18n Sync - nothing is written; this is what --apply would change\n',
  );

  const plan = await planSync();
  if (apply) await applyPlan(plan);
  reportPlan(plan, { apply });

  if (apply) {
    console.log('\nDone!');
  } else {
    console.log('\nNo files were touched. Re-run with --apply to write.');
  }
}

// Run the full sync only when invoked directly, not when imported for the prune
// helper or the plan (importing must not rewrite every locale file).
if (isCli(import.meta.url)) {
  await main();
}
