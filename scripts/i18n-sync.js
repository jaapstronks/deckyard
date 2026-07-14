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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const I18N_DIR = path.join(__dirname, '..', 'client', 'i18n');
const LANGUAGES = ['nl', 'de', 'fr', 'es', 'pt', 'da', 'sv', 'no'];
const MODULES = ['common', 'auth', 'editor', 'list', 'share', 'settings', 'presenter', 'slide-types'];

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

function main() {
  console.log('i18n Sync - Fill missing keys with English\n');

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

main();
