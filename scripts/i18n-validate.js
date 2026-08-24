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
 * - Missing keys (compared to the reference locale)
 * - Empty values
 *
 * Scope — which locales, which module files — comes from
 * `client/i18n/manifest.json` by way of `i18n-locales.js`, so this script and
 * `i18n-sync.js` cannot check different sets of files. `follow.json` is
 * included: it is a `deck`-loader module rather than one of `ui-i18n.js`'s
 * `I18N_COMPONENTS`, but a syntax error or a duplicate key breaks it exactly
 * the same way.
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

import { LOCALE_IDS, MODULES, REFERENCE_LOCALE } from './i18n-locales.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const I18N_DIR = path.join(__dirname, '..', 'client', 'i18n');

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
 * files are flat, one-key-per-line maps (as `i18n:sync`/`i18n:fill` emit them),
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

// The reference locale's module files are loaded twice (once as the reference,
// once in the per-locale loop); check each path for duplicates only the first
// time so a hit is reported once, not twice.
const dupChecked = new Set();

function loadJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!dupChecked.has(filePath)) {
      dupChecked.add(filePath);
      const rel = path.relative(path.join(__dirname, '..'), filePath);
      for (const dup of findDuplicateKeys(content)) {
        error(
          `${rel}:${dup.line}: Duplicate key "${dup.key}" (first defined at line ${dup.firstLine})`,
        );
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

  // Load the reference locale
  const referenceData = {};
  for (const moduleName of MODULES) {
    const refPath = path.join(I18N_DIR, REFERENCE_LOCALE, `${moduleName}.json`);
    const { data } = loadJson(refPath);
    if (data) {
      Object.assign(referenceData, data);
    }
  }

  const referenceKeys = new Set(Object.keys(referenceData));
  console.log(
    `Reference locale ${REFERENCE_LOCALE}: ${referenceKeys.size} keys (across all modules)\n`,
  );

  // Validate each language
  for (const lang of LOCALE_IDS) {
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
      console.log(
        `  ${moduleName}.json: ${keyCount} keys, ${countLines(content)} lines`,
      );

      // Check for empty values
      for (const [key, value] of Object.entries(data)) {
        langKeys.add(key);
        if (typeof value === 'string' && value.trim() === '') {
          warn(`${lang}/${moduleName}.json: Empty value for "${key}"`);
        }
      }
    }

    // index.json is a dead artifact from the pre-modularization layout:
    // client/lib/ui-i18n.js fetches the per-module files directly and nothing
    // reads the merged file. Nothing writes one any more either (B130 removed
    // the three generators), so one on disk is a leftover from an older
    // checkout — report it so it gets deleted rather than committed.
    const indexPath = path.join(I18N_DIR, lang, 'index.json');
    if (fs.existsSync(indexPath)) {
      warn(
        `${lang}/index.json: stale artifact, nothing reads or writes it — delete it`,
      );
    }

    // Check for missing keys (compared to the reference locale)
    if (lang !== REFERENCE_LOCALE) {
      const missingKeys = [...referenceKeys].filter((k) => !langKeys.has(k));
      if (missingKeys.length > 0) {
        warn(
          `${lang}: ${missingKeys.length} keys missing compared to ${REFERENCE_LOCALE}`,
        );
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
