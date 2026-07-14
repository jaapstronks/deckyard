#!/usr/bin/env node
/**
 * i18n Modularization Script
 *
 * Transforms flat language JSON files into a modular structure:
 * - Creates shared.json for language-agnostic strings
 * - Splits each language into category-based modules
 * - Generates merged index.json for each locale
 *
 * Usage: node scripts/i18n-modularize.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const I18N_DIR = path.join(__dirname, '..', 'client', 'i18n');
const LANGUAGES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'da', 'sv', 'no'];

// Module definitions: maps key prefixes to module names
const MODULE_MAP = {
  'common': 'common',
  'app': 'common',
  'follow': 'common',
  'login': 'auth',
  'forgotPassword': 'auth',
  'resetPassword': 'auth',
  'editor': 'editor',
  'list': 'list',
  'slideLibrary': 'list',
  'imageLibrary': 'list',
  'share': 'share',
  'shareViewer': 'share',
  'moderate': 'share',
  'settings': 'settings',
  'admin': 'settings',
  'presenter': 'presenter',
  'notesJoin': 'presenter',
  'slideType': 'slide-types',
};

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Error loading ${filePath}:`, e.message);
    return null;
  }
}

function saveJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function getKeyPrefix(key) {
  const idx = key.indexOf('.');
  return idx > -1 ? key.slice(0, idx) : key;
}

function getModule(key) {
  const prefix = getKeyPrefix(key);
  return MODULE_MAP[prefix] || 'common';
}

function findSharedKeys(langData) {
  // Keys with identical values across all languages that have them
  const enKeys = Object.keys(langData.en || {});
  const shared = {};

  for (const key of enKeys) {
    const enValue = langData.en[key];
    let isShared = true;

    for (const lang of LANGUAGES) {
      if (langData[lang] && langData[lang][key] !== undefined) {
        if (langData[lang][key] !== enValue) {
          isShared = false;
          break;
        }
      }
    }

    if (isShared) {
      shared[key] = enValue;
    }
  }

  return shared;
}

function splitIntoModules(data, sharedKeys) {
  const modules = {};

  for (const [key, value] of Object.entries(data)) {
    // Skip if this key is in shared
    if (sharedKeys[key] !== undefined) continue;

    const moduleName = getModule(key);
    if (!modules[moduleName]) {
      modules[moduleName] = {};
    }
    modules[moduleName][key] = value;
  }

  return modules;
}

function sortKeys(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

function countLines(obj) {
  // Estimate lines: 1 for opening brace, 1 per key, 1 for closing brace
  return Object.keys(obj).length + 2;
}

function main() {
  console.log('i18n Modularization\n');

  // Load all language data
  const langData = {};
  for (const lang of LANGUAGES) {
    const filePath = path.join(I18N_DIR, `${lang}.json`);
    langData[lang] = loadJson(filePath);
    if (!langData[lang]) {
      console.error(`Failed to load ${lang}.json, aborting.`);
      process.exit(1);
    }
  }

  // Find shared keys
  const sharedKeys = findSharedKeys(langData);
  console.log(`Found ${Object.keys(sharedKeys).length} shared keys (language-agnostic)`);

  // Save shared.json
  const sharedPath = path.join(I18N_DIR, 'shared.json');
  saveJson(sharedPath, sortKeys(sharedKeys));
  console.log(`Created ${sharedPath} (${countLines(sharedKeys)} lines)`);

  // Process each language
  for (const lang of LANGUAGES) {
    const langDir = path.join(I18N_DIR, lang);
    const data = langData[lang];

    // Split into modules
    const modules = splitIntoModules(data, sharedKeys);

    console.log(`\n${lang.toUpperCase()}:`);

    // Save each module
    for (const [moduleName, moduleData] of Object.entries(modules)) {
      const modulePath = path.join(langDir, `${moduleName}.json`);
      saveJson(modulePath, sortKeys(moduleData));
      console.log(`  ${moduleName}.json: ${Object.keys(moduleData).length} keys (${countLines(moduleData)} lines)`);
    }

    // Create merged index.json (shared + all modules)
    const merged = { ...sharedKeys };
    for (const moduleData of Object.values(modules)) {
      Object.assign(merged, moduleData);
    }

    const indexPath = path.join(langDir, 'index.json');
    saveJson(indexPath, sortKeys(merged));
    console.log(`  index.json: ${Object.keys(merged).length} keys (merged)`);
  }

  console.log('\nDone! Module structure created.');
  console.log('\nNext steps:');
  console.log('1. Update ui-i18n.js to load from {locale}/index.json');
  console.log('2. Remove old flat {locale}.json files after testing');
}

main();
