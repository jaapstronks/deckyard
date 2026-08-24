#!/usr/bin/env node
/**
 * i18n Sync Script
 *
 * Synchronizes all language files with English (reference): prunes
 * `slideType.*` keys the registry no longer produces, then fills the keys a
 * locale is missing with their English values as placeholders.
 *
 * Scope comes from `client/i18n/manifest.json` by way of `i18n-locales.js`:
 * the prune sweeps every locale × every module, the fill copies the reference
 * locale's `ui` modules into every other locale. Nothing here keeps its own
 * spelling of those lists — see i18n-locales.js for what the four hand-kept
 * ones cost.
 *
 * Split in two halves on purpose. `planSync()` only reads — it returns the
 * complete list of edits the run would make — and `applyPlan()` is the only
 * thing that touches disk. `--dry-run` runs the first half and prints it, so
 * "what would this do?" is answerable without a working copy to clean up
 * afterwards (the fill half wants to write thousands of keys per locale).
 *
 * Usage:
 *   node scripts/i18n-sync.js              # prune + fill, writing to disk
 *   node scripts/i18n-sync.js --dry-run    # report the same plan, write nothing
 */

import path from 'node:path';

import { SLIDE_TYPES } from '../shared/slide-types.js';
import { slideTypeUiKeys } from './lib/slide-type-i18n-keys.js';
import { I18N_DIR, readJson, writeJson } from './lib/i18n-fs.js';
import { isCli } from './lib/is-cli.js';
import {
  FILL_LOCALES,
  LOCALE_IDS,
  MODULES,
  REFERENCE_LOCALE,
  UI_MODULES,
} from './lib/i18n-locales.js';

/** How many key names a dry-run prints per file before summarizing the rest. */
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
 * @property {string[]} filled     keys copied in from English
 * @property {object} data         the file's contents with both edits applied
 */

/**
 * @typedef {object} SyncPlan
 * @property {SyncFileEdit[]} edits  one entry per file that would change
 * @property {number} totalPruned    keys removed across all files
 * @property {number} totalFilled    keys added across all files
 * @property {string[]} skippedModules modules with no reference source to fill from
 * @property {SyncScope} scope       the locale/module matrix the plan covers
 */

/**
 * @typedef {object} SyncScope
 * @property {string[]} locales      locales the prune sweeps
 * @property {string[]} modules      modules the prune sweeps
 * @property {string[]} fillLocales  locales the fill writes into
 * @property {string[]} fillModules  modules the fill writes
 * @property {string} reference      locale the fill copies from
 */

/**
 * Compute every edit a sync would make, without touching disk.
 *
 * Prune before fill, and both in memory: filling copies English into each
 * locale, so a dead key left in English would be handed straight back to every
 * locale the prune just cleaned.
 *
 * **The prune** removes `slideType.*` keys the registry no longer produces.
 * Nothing else deletes them: `i18n-fill` only ever adds, and the audit's orphan
 * check skips the whole `slideType.` family as runtime-built. So a field, option or type that
 * leaves the registry strands its translations in every locale forever. The
 * registry is the authority on which keys are real; anything under `slideType.`
 * that it does not generate is dead — including in English, which drifts the
 * same way (the fill step merges into the existing file rather than replacing
 * it). Scoped to the `slideType.` namespace on purpose: keys like
 * `editor.slideTypeDesc.<type>` are runtime-built fallbacks a locale may hold
 * without English (the picker resolves them against the authoring default), so a
 * blanket "not in English" prune would delete live translations. The valid set
 * is `liveSlideTypeI18nKeys()`, which keeps fork types — see there for why
 * excluding them would silently delete a fork's translations (#499).
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
        filled: [],
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

  // Fill pass — the reference locale (post-prune) into every other locale.
  // Narrowed to the `ui` modules: a `deck` module is resolved against the deck
  // language, which only ever lands on a Tier-1 locale, so filling the other
  // ten would write files no loader can reach.
  for (const moduleName of UI_MODULES) {
    const referenceData = loaded.get(`${REFERENCE_LOCALE}/${moduleName}`);
    if (!referenceData) {
      skippedModules.push(moduleName);
      continue;
    }
    const referenceKeys = Object.keys(referenceData);

    for (const locale of FILL_LOCALES) {
      const id = `${locale}/${moduleName}`;
      const filePath = path.join(I18N_DIR, locale, `${moduleName}.json`);
      const data = loaded.get(id) || {};
      loaded.set(id, data);

      const missing = referenceKeys.filter((k) => data[k] === undefined);
      if (missing.length === 0) continue;

      for (const k of missing) data[k] = referenceData[k];
      editFor(locale, moduleName, filePath, data).filled.push(...missing);
    }
  }

  const list = [...edits.values()];
  return {
    edits: list,
    totalPruned: list.reduce((n, e) => n + e.pruned.length, 0),
    totalFilled: list.reduce((n, e) => n + e.filled.length, 0),
    skippedModules,
    // Reported, not just used: the scope is the whole point of the manifest
    // being the source, so a dry run states it and the tests assert on it
    // rather than re-deriving what the loops above happened to iterate.
    scope: {
      locales: [...LOCALE_IDS],
      modules: [...MODULES],
      fillLocales: [...FILL_LOCALES],
      fillModules: [...UI_MODULES],
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

function reportPlan(plan, { dryRun }) {
  const { locales, modules, fillLocales, fillModules, reference } = plan.scope;
  console.log(
    `Scope (client/i18n/manifest.json): pruning ${locales.length} locale(s) × ` +
      `${modules.length} module(s); filling ${fillLocales.length} locale(s) × ` +
      `${fillModules.length} module(s) from ${reference}.\n`,
  );

  for (const edit of plan.edits) {
    const parts = [];
    if (edit.pruned.length)
      parts.push(`-${edit.pruned.length} orphaned slideType key(s)`);
    if (edit.filled.length)
      parts.push(`+${edit.filled.length} key(s) from English`);
    console.log(`${edit.locale}/${edit.module}.json: ${parts.join(', ')}`);
    if (dryRun && edit.pruned.length) {
      console.log('    pruned:');
      console.log(formatKeys(edit.pruned));
    }
    if (dryRun && edit.filled.length) {
      console.log('    filled:');
      console.log(formatKeys(edit.filled));
    }
  }

  for (const moduleName of plan.skippedModules) {
    console.log(`Skipping ${moduleName}: no English source`);
  }

  console.log(
    `\n${plan.edits.length} file(s) ${dryRun ? 'would change' : 'changed'}: ` +
      `${plan.totalPruned} orphaned slideType key(s) pruned, ` +
      `${plan.totalFilled} key(s) filled with English.`,
  );
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const unknown = argv.filter((a) => a !== '--dry-run');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}`);
    console.error('Usage: node scripts/i18n-sync.js [--dry-run]');
    process.exit(1);
  }

  console.log(
    dryRun
      ? 'i18n Sync (dry run) - nothing is written; this is what would change\n'
      : 'i18n Sync - Prune orphaned slide-type keys, then fill missing keys with English\n',
  );

  const plan = await planSync();
  if (!dryRun) await applyPlan(plan);
  reportPlan(plan, { dryRun });

  if (dryRun) {
    console.log(
      '\nDry run: no files were touched. Re-run without --dry-run to apply.',
    );
  } else {
    console.log('\nDone!');
  }
}

// Run the full sync only when invoked directly, not when imported for the prune
// helper or the plan (importing must not rewrite every locale file).
if (isCli(import.meta.url)) {
  await main();
}
