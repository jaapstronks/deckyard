#!/usr/bin/env node
/**
 * i18n Merge Script
 *
 * Merges module files into index.json for each locale.
 * Run this after editing any i18n module file.
 *
 * Usage: node scripts/i18n-merge.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const I18N_DIR = path.join(__dirname, '..', 'client', 'i18n');
const LANGUAGES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'da', 'sv', 'no'];
const MODULES = ['common', 'auth', 'editor', 'list', 'share', 'settings', 'presenter', 'slide-types'];

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Error loading ${filePath}:`, e.message);
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
  console.log('i18n Merge - Rebuilding index.json files\n');

  // Load shared.json
  const sharedPath = path.join(I18N_DIR, 'shared.json');
  const shared = loadJson(sharedPath);
  if (!shared) {
    console.error('Failed to load shared.json');
    process.exit(1);
  }

  for (const lang of LANGUAGES) {
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
