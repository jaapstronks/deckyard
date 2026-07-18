/**
 * Case discovery and loading.
 *
 * A case is a directory under `test-suite/cases/<case-id>/` holding a
 * `case.json` manifest plus (once fetched) `source/` and optionally
 * `reference/`. Only the manifest is committed -- see scripts/fetch-cases.js.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { CASES_DIR } from './config.js';

/**
 * @typedef {Object} CaseManifest
 * @property {string} id
 * @property {string} title
 * @property {'A'|'B'} category - A: has a human reference deck; B: source only
 * @property {'nl'|'en'} language
 * @property {string} domain
 * @property {{url: string, file: string, type: string, note?: string}[]} sources
 * @property {{url: string, file: string, type: string}[]} [reference]
 * @property {string} licence
 * @property {string[]} expectedCharacteristics
 */

/**
 * Load every case manifest, sorted by id.
 *
 * @param {string[]} [ids] - Optional filter; unknown ids throw.
 * @returns {Promise<CaseManifest[]>}
 */
export async function loadCases(ids = null) {
  let entries = [];
  try {
    entries = await fs.readdir(CASES_DIR, { withFileTypes: true });
  } catch {
    throw new Error(`No cases directory at ${CASES_DIR}. Run the fetch script first.`);
  }

  const cases = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(CASES_DIR, entry.name, 'case.json');
    let raw;
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      continue;
    }
    const manifest = JSON.parse(raw);
    manifest.id = manifest.id || entry.name;
    manifest.dir = path.join(CASES_DIR, entry.name);
    cases.push(manifest);
  }

  cases.sort((a, b) => a.id.localeCompare(b.id));

  if (!ids || !ids.length) return cases;

  const known = new Set(cases.map((c) => c.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(
      `Unknown case id(s): ${unknown.join(', ')}. Available: ${[...known].join(', ')}`
    );
  }
  return cases.filter((c) => ids.includes(c.id));
}

/**
 * Map a downloaded asset's filename to its extracted-text filename.
 *
 * Both the fetch script (which writes the .txt) and the readers (which consume
 * it) must agree on this. They previously used separate regexes that drifted:
 * the reader handled only pdf/doc, so for .html and .wiki assets it fell
 * through to the original file and fed raw markup into the pipeline -- 370 KB
 * of HTML instead of 17 KB of text for one case.
 *
 * @param {string} file - Downloaded filename, e.g. "article.wiki"
 * @returns {string} e.g. "article.txt"
 */
export function sourceTextFilename(file) {
  return String(file).replace(/\.(pdf|docx?|html?|wiki|md|markdown)$/i, '.txt');
}

/**
 * Read a case's fetched source text, concatenating multiple source files.
 *
 * @param {CaseManifest} testCase
 * @returns {Promise<string>}
 * @throws if the source has not been fetched yet
 */
export async function readSourceText(testCase) {
  const parts = [];
  for (const source of testCase.sources || []) {
    const textFile = sourceTextFilename(source.file);
    const filePath = path.join(testCase.dir, 'source', textFile);
    try {
      parts.push(await fs.readFile(filePath, 'utf8'));
    } catch {
      throw new Error(
        `Missing source text for case "${testCase.id}": ${filePath}\n` +
          `Run: node test-suite/scripts/fetch-cases.js --cases ${testCase.id}`
      );
    }
  }
  const text = parts.join('\n\n---\n\n').trim();
  if (!text) throw new Error(`Case "${testCase.id}" has no source text.`);
  return text;
}

/**
 * Read a case's parsed reference deck, if it has one.
 *
 * @param {CaseManifest} testCase
 * @returns {Promise<{slides: {title: string, text: string, wordCount: number}[]}|null>}
 */
export async function readReferenceDeck(testCase) {
  if (testCase.category !== 'A') return null;
  const filePath = path.join(testCase.dir, 'reference', 'parsed.json');
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
