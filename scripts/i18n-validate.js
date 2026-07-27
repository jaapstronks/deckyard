#!/usr/bin/env node
/**
 * i18n Validation Script
 *
 * Validates i18n files for:
 * - JSON syntax errors
 * - Duplicate keys (JSON.parse silently keeps the last, so a fork-merge that
 *   pasted 22 keys twice into editor.json parsed clean and this script said
 *   PASSED — the files were quietly corrupt. Detected over the raw lines below,
 *   not the parsed object, which is the only place the duplicate survives.)
 * - Missing keys (compared to English reference)
 * - Empty values
 *
 * Line counts are reported but never enforced: these are generated key/value
 * maps, so length carries no complexity signal. See docs/developer/i18n.md.
 *
 * Usage: node scripts/i18n-validate.js
 * Exit code: 0 if valid, 1 if errors found
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const I18N_DIR = path.join(__dirname, '..', 'client', 'i18n');
// Keep in sync with client/i18n/manifest.json (it/fi/pl were shipped but never
// added here, so they went unvalidated).
const LANGUAGES = ['en', 'nl', 'de', 'fr', 'es', 'pt', 'it', 'pl', 'fi', 'da', 'sv', 'no'];
// `follow` is intentionally absent from I18N_COMPONENTS in client/lib/ui-i18n.js
// (it is loaded per deck language by client/views/follow/i18n.js), but the files
// still exist per locale and should be validated like any other module.
const MODULES = ['common', 'auth', 'editor', 'list', 'share', 'settings', 'presenter', 'slide-types', 'follow'];

let hasErrors = false;

function error(msg) {
  console.error(`ERROR: ${msg}`);
  hasErrors = true;
}

function warn(msg) {
  console.warn(`WARN: ${msg}`);
}

/**
 * Duplicate keys, found over the raw text because `JSON.parse` keeps only the
 * last of a repeated key and so erases the very evidence of the bug. The i18n
 * files are flat, one-key-per-line maps (as `i18n:merge`/`i18n:sync` emit them),
 * so a leading `"key":` on a line reliably marks a top-level key. Keys are
 * compared by their raw source text — locale keys are plain dotted identifiers
 * with no escapes, so a repeat is byte-identical.
 * @param {string} content - the file's raw text
 * @returns {Array<{key: string, line: number, firstLine: number}>}
 */
export function findDuplicateKeys(content) {
  const keyRe = /^\s*"((?:\\.|[^"\\])*)"\s*:/;
  const firstSeen = new Map();
  const duplicates = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = keyRe.exec(lines[i]);
    if (!match) continue;
    const key = match[1];
    if (firstSeen.has(key)) {
      duplicates.push({ key, line: i + 1, firstLine: firstSeen.get(key) });
    } else {
      firstSeen.set(key, i + 1);
    }
  }
  return duplicates;
}

// English module files are loaded twice (once as the reference, once in the
// per-locale loop); check each path for duplicates only the first time so a hit
// is reported once, not twice.
const dupChecked = new Set();

function loadJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!dupChecked.has(filePath)) {
      dupChecked.add(filePath);
      const rel = path.relative(path.join(__dirname, '..'), filePath);
      for (const dup of findDuplicateKeys(content)) {
        error(`${rel}:${dup.line}: Duplicate key "${dup.key}" (first defined at line ${dup.firstLine})`);
      }
    }
    return { data: JSON.parse(content), content };
  } catch (e) {
    error(`${filePath}: ${e.message}`);
    return { data: null, content: null };
  }
}

function countLines(content) {
  return content ? content.split('\n').length : 0;
}

function main() {
  console.log('i18n Validation\n');

  // Validate shared.json
  const sharedPath = path.join(I18N_DIR, 'shared.json');
  const { data: shared, content: sharedContent } = loadJson(sharedPath);
  if (shared) {
    console.log(`shared.json: ${Object.keys(shared).length} keys, ${countLines(sharedContent)} lines`);
  }

  // Load English as reference
  const enData = {};
  for (const moduleName of MODULES) {
    const enPath = path.join(I18N_DIR, 'en', `${moduleName}.json`);
    const { data } = loadJson(enPath);
    if (data) {
      Object.assign(enData, data);
    }
  }

  const enKeys = new Set(Object.keys(enData));
  console.log(`\nEnglish reference: ${enKeys.size} keys (across all modules)\n`);

  // Validate each language
  for (const lang of LANGUAGES) {
    console.log(`${lang.toUpperCase()}:`);
    let langKeys = new Set();

    for (const moduleName of MODULES) {
      const modulePath = path.join(I18N_DIR, lang, `${moduleName}.json`);

      if (!fs.existsSync(modulePath)) {
        error(`${lang}/${moduleName}.json: File missing`);
        continue;
      }

      const { data, content } = loadJson(modulePath);
      if (!data) continue;

      const keyCount = Object.keys(data).length;
      console.log(`  ${moduleName}.json: ${keyCount} keys, ${countLines(content)} lines`);

      // Check for empty values
      for (const [key, value] of Object.entries(data)) {
        langKeys.add(key);
        if (typeof value === 'string' && value.trim() === '') {
          warn(`${lang}/${moduleName}.json: Empty value for "${key}"`);
        }
      }
    }

    // Validate index.json
    const indexPath = path.join(I18N_DIR, lang, 'index.json');
    if (fs.existsSync(indexPath)) {
      const { data: indexData } = loadJson(indexPath);
      if (indexData) {
        const indexKeys = Object.keys(indexData).length;
        const expectedKeys = langKeys.size + (shared ? Object.keys(shared).length : 0);
        console.log(`  index.json: ${indexKeys} keys`);

        if (indexKeys !== expectedKeys) {
          warn(`${lang}/index.json key count (${indexKeys}) doesn't match modules + shared (${expectedKeys})`);
        }
      }
    }
    // No `else`: index.json is a leftover from the pre-modularization layout.
    // No locale ships one and client/lib/ui-i18n.js fetches the per-module
    // files directly, so its absence is not an error — it is only checked for
    // consistency when a locale happens to still have one.

    // Check for missing keys (compared to English)
    if (lang !== 'en') {
      const missingKeys = [...enKeys].filter(k => !langKeys.has(k) && (!shared || !shared[k]));
      if (missingKeys.length > 0) {
        warn(`${lang}: ${missingKeys.length} keys missing compared to English`);
      }
    }

    console.log('');
  }

  // Summary
  if (hasErrors) {
    console.log('Validation FAILED - errors found above');
    process.exit(1);
  } else {
    console.log('Validation PASSED');
    process.exit(0);
  }
}

// Run the full validation only when invoked directly (`node scripts/...`), not
// when imported for its helpers — importing must not trigger process.exit.
if (process.argv[1] === __filename) {
  main();
}
