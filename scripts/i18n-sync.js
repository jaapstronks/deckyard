#!/usr/bin/env node
/**
 * i18n Sync Script
 *
 * Synchronizes all language files with English (reference).
 * Missing keys are filled with English values as placeholders.
 *
 * Usage: node scripts/i18n-sync.js
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
const MODULES = ['common', 'auth', 'editor', 'list', 'share', 'settings', 'presenter', 'slide-types'];
// Every locale on disk, not just the fill targets: it/pl/fi ship translations
// but never sat in LANGUAGES, so their orphaned slideType keys went unpruned too.
const ALL_LOCALES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'fi', 'da', 'sv', 'no'];

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
 * Derived from the whole of `SLIDE_TYPES`, fork types **included**: the prune
 * passes no skip-set, unlike `i18n-extract` (which excludes
 * `CUSTOM_SLIDE_TYPE_NAMES` so a fork's strings can't leak into the shared
 * extraction template). The prune has the opposite duty — a fork type's keys are
 * as live as a core type's, so narrowing this set to core would make the prune
 * silently delete a fork's own translations, and delete a core type's keys
 * outright once a fork registers over its name with `override: true`. That
 * asymmetry is the #499 regression; `tests/fork-slide-type-derivations.test.js`
 * pins it against a file-based fork type loaded from `custom/slide-types/`, which
 * is the only place it is observable.
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
 * Remove `slideType.*` keys the registry no longer produces.
 *
 * Nothing else deletes them: `i18n-extract` only ever adds, `i18n-validate` only
 * flags keys *missing* from English, and the audit's orphan check skips the whole
 * `slideType.` family as runtime-built. So a field, option or type that leaves
 * the registry strands its translations in every locale forever. The registry is
 * the authority on which keys are real; anything under `slideType.` that it does
 * not generate is dead and pruned here — including from English, which drifts the
 * same way (extract merges into the existing file rather than replacing it).
 *
 * Scoped to the `slideType.` namespace on purpose: keys like
 * `editor.slideTypeDesc.<type>` are runtime-built fallbacks a locale may hold
 * without English (the picker resolves them against the authoring default), so a
 * blanket "not in English" prune would delete live translations.
 *
 * The valid set is `liveSlideTypeI18nKeys()`, which keeps fork types — see there
 * for why excluding them would silently delete a fork's translations (#499).
 *
 * @returns {number} total keys removed across all locales
 */
function pruneOrphanedSlideTypeKeys() {
  const valid = liveSlideTypeI18nKeys();
  let totalPruned = 0;

  for (const lang of ALL_LOCALES) {
    for (const moduleName of MODULES) {
      const modulePath = path.join(I18N_DIR, lang, `${moduleName}.json`);
      const data = loadJson(modulePath);
      if (!data) continue;

      const dead = Object.keys(data).filter((k) => k.startsWith('slideType.') && !valid.has(k));
      if (dead.length === 0) continue;

      // Delete in place and keep the file's existing order: a prune should be a
      // clean set of removed lines, not a whole-file re-sort (en/it/pl/fi are not
      // stored in this script's sort order, and re-sorting them here would bury
      // the deletions under hundreds of moved lines).
      for (const k of dead) delete data[k];
      saveJson(modulePath, data);
      console.log(`${lang}/${moduleName}.json: -${dead.length} orphaned slideType key(s)`);
      totalPruned += dead.length;
    }
  }

  console.log(`\nTotal orphaned slideType keys pruned: ${totalPruned}`);
  return totalPruned;
}

function main() {
  console.log('i18n Sync - Prune orphaned slide-type keys, then fill missing keys with English\n');

  // Prune first: filling copies English into each locale, so a dead key left in
  // English would be handed straight back to every locale we just cleaned.
  pruneOrphanedSlideTypeKeys();

  console.log('\nFilling missing keys with English\n');

  let totalAdded = 0;

  for (const moduleName of MODULES) {
    const enPath = path.join(I18N_DIR, 'en', `${moduleName}.json`);
    const enData = loadJson(enPath);

    if (!enData) {
      console.log(`Skipping ${moduleName}: no English source`);
      continue;
    }

    const enKeys = Object.keys(enData);

    for (const lang of LANGUAGES) {
      const langPath = path.join(I18N_DIR, lang, `${moduleName}.json`);
      const langData = loadJson(langPath) || {};

      let addedCount = 0;
      for (const key of enKeys) {
        if (langData[key] === undefined) {
          langData[key] = enData[key];
          addedCount++;
        }
      }

      if (addedCount > 0) {
        saveJson(langPath, sortKeys(langData));
        console.log(`${lang}/${moduleName}.json: +${addedCount} keys`);
        totalAdded += addedCount;
      }
    }
  }

  console.log(`\nTotal keys added: ${totalAdded}`);

  // Regenerate index.json files for each language
  console.log('\nRegenerating index.json files...');

  const sharedPath = path.join(I18N_DIR, 'shared.json');
  const shared = loadJson(sharedPath) || {};

  for (const lang of ['en', ...LANGUAGES]) {
    const langDir = path.join(I18N_DIR, lang);
    const merged = { ...shared };

    for (const moduleName of MODULES) {
      const modulePath = path.join(langDir, `${moduleName}.json`);
      const moduleData = loadJson(modulePath);
      if (moduleData) {
        Object.assign(merged, moduleData);
      }
    }

    const indexPath = path.join(langDir, 'index.json');
    saveJson(indexPath, sortKeys(merged));
    console.log(`${lang}/index.json: ${Object.keys(merged).length} keys`);
  }

  console.log('\nDone!');
}

// Run the full sync only when invoked directly, not when imported for the prune
// helper (importing must not rewrite every locale file).
if (process.argv[1] === __filename) {
  main();
}
