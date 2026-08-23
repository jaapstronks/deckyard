#!/usr/bin/env node
/**
 * i18n Sync Script
 *
 * Synchronizes all language files with English (reference): prunes
 * `slideType.*` keys the registry no longer produces, then fills the keys a
 * locale is missing with their English values as placeholders.
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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { SLIDE_TYPES } from '../shared/slide-types.js';
import { slideTypeUiKeys } from './lib/slide-type-i18n-keys.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const I18N_DIR = path.join(__dirname, '..', 'client', 'i18n');
const LANGUAGES = ['nl', 'de', 'fr', 'es', 'pt', 'da', 'sv', 'no'];
const MODULES = [
  'common',
  'auth',
  'editor',
  'list',
  'share',
  'settings',
  'presenter',
  'slide-types',
];
// Every locale on disk, not just the fill targets: it/pl/fi ship translations
// but never sat in LANGUAGES, so their orphaned slideType keys went unpruned too.
const ALL_LOCALES = [
  'en',
  'nl',
  'de',
  'fr',
  'es',
  'pt',
  'it',
  'pl',
  'fi',
  'da',
  'sv',
  'no',
];

/** How many key names a dry-run prints per file before summarizing the rest. */
const DRY_RUN_KEY_SAMPLE = 10;

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function sortKeys(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

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
 * @property {string[]} skippedModules modules with no English source to fill from
 */

/**
 * Compute every edit a sync would make, without touching disk.
 *
 * Prune before fill, and both in memory: filling copies English into each
 * locale, so a dead key left in English would be handed straight back to every
 * locale the prune just cleaned.
 *
 * **The prune** removes `slideType.*` keys the registry no longer produces.
 * Nothing else deletes them: `i18n-fill` only ever adds, `i18n-validate` only
 * flags keys *missing* from English, and the audit's orphan check skips the
 * whole `slideType.` family as runtime-built. So a field, option or type that
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
 * @returns {SyncPlan} the edits, keyed per file
 */
export function planSync() {
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

  // Prune pass — every locale on disk, English included.
  for (const locale of ALL_LOCALES) {
    for (const moduleName of MODULES) {
      const filePath = path.join(I18N_DIR, locale, `${moduleName}.json`);
      const data = loadJson(filePath);
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

  // Fill pass — English (post-prune) into the fill-target locales.
  for (const moduleName of MODULES) {
    const enData = loaded.get(`en/${moduleName}`);
    if (!enData) {
      skippedModules.push(moduleName);
      continue;
    }
    const enKeys = Object.keys(enData);

    for (const locale of LANGUAGES) {
      const id = `${locale}/${moduleName}`;
      const filePath = path.join(I18N_DIR, locale, `${moduleName}.json`);
      const data = loaded.get(id) || {};
      loaded.set(id, data);

      const missing = enKeys.filter((k) => data[k] === undefined);
      if (missing.length === 0) continue;

      for (const k of missing) data[k] = enData[k];
      editFor(locale, moduleName, filePath, data).filled.push(...missing);
    }
  }

  const list = [...edits.values()];
  return {
    edits: list,
    totalPruned: list.reduce((n, e) => n + e.pruned.length, 0),
    totalFilled: list.reduce((n, e) => n + e.filled.length, 0),
    skippedModules,
  };
}

/**
 * Write a plan's edits to disk.
 *
 * A file that only lost keys keeps its existing order: a prune should read as a
 * clean set of removed lines, not a whole-file re-sort (en/it/pl/fi are not
 * stored in this script's sort order, and re-sorting them here would bury the
 * deletions under hundreds of moved lines). A file that gained keys is sorted,
 * because the new keys have to land somewhere deterministic.
 *
 * @param {SyncPlan} plan
 * @returns {void}
 */
export function applyPlan(plan) {
  for (const edit of plan.edits) {
    saveJson(
      edit.filePath,
      edit.filled.length ? sortKeys(edit.data) : edit.data,
    );
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

function main(argv = process.argv.slice(2)) {
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

  const plan = planSync();
  if (!dryRun) applyPlan(plan);
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
if (process.argv[1] === __filename) {
  main();
}
