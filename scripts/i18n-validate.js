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
 * - Keys the locale has and the reference locale does not (drift the other
 *   way: an orphan is a string nobody can see in English)
 * - The same key filed in two module files of one locale (the runtime merges
 *   the modules, so a cross-file repeat is the in-file duplicate one level up:
 *   invisible, and one of the two copies is dead)
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

import fs from 'node:fs';
import path from 'node:path';

import { I18N_DIR, REPO_ROOT } from './lib/i18n-fs.js';
import { isCli } from './lib/is-cli.js';
import { LOCALE_IDS, MODULES, REFERENCE_LOCALE } from './lib/i18n-locales.js';

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
      const rel = path.relative(REPO_ROOT, filePath);
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

  // en/ files a key in exactly one module; that is the reference for where a
  // key belongs, and `i18n-fill.js` routes new keys there (B137).
  const referenceHome = new Map();
  for (const moduleName of MODULES) {
    const refPath = path.join(I18N_DIR, REFERENCE_LOCALE, `${moduleName}.json`);
    const { data } = loadJson(refPath);
    for (const key of Object.keys(data || {}))
      if (!referenceHome.has(key)) referenceHome.set(key, moduleName);
  }

  // Validate each language
  for (const lang of LOCALE_IDS) {
    console.log(`${lang.toUpperCase()}:`);
    let langKeys = new Set();
    /** @type {Map<string, string>} key -> the module that first defined it */
    const keyHome = new Map();

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

      // Check for empty values, and for a key filed in two modules at once
      for (const [key, value] of Object.entries(data)) {
        if (keyHome.has(key)) {
          error(
            `${lang}/${moduleName}.json: "${key}" is also in ${lang}/${keyHome.get(key)}.json — one key, one module file`,
          );
        } else {
          keyHome.set(key, moduleName);
        }
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
      // Drift the other way: a key only this locale has renders nothing at all
      // in English, because the fallback chain ends at the reference locale.
      const orphanKeys = [...langKeys].filter((k) => !referenceKeys.has(k));
      if (orphanKeys.length > 0) {
        warn(
          `${lang}: ${orphanKeys.length} keys ${REFERENCE_LOCALE} does not have: ${orphanKeys.slice(0, 5).join(', ')}${orphanKeys.length > 5 ? ', …' : ''}`,
        );
      }
    }

    // A key that exists in the reference locale belongs in the same module
    // file here; anything else drifts the locale directories apart.
    const misfiled = [...keyHome].filter(
      ([key, mod]) => referenceHome.has(key) && referenceHome.get(key) !== mod,
    );
    if (misfiled.length > 0) {
      warn(
        `${lang}: ${misfiled.length} keys filed in a different module than ${REFERENCE_LOCALE}: ${misfiled
          .slice(0, 3)
          .map(([k, m]) => `${k} (${m} → ${referenceHome.get(k)})`)
          .join('; ')}${misfiled.length > 3 ? '; …' : ''}`,
      );
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
if (isCli(import.meta.url)) {
  main();
}
