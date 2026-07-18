#!/usr/bin/env node
/**
 * Turn a human reference deck (a slide PDF) into a structured representation:
 * one entry per slide with a title, its text, and a word count. That is what
 * makes programmatic comparison against a generated deck possible.
 *
 * Usage:
 *   node test-suite/scripts/parse-reference.js [--cases a,b] [--force]
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadCases } from '../lib/cases.js';

async function main() {
  const argv = process.argv.slice(2);
  let only = null;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cases') only = argv[(i += 1)].split(',').map((s) => s.trim());
    else if (argv[i] === '--force') force = true;
  }

  const cases = (await loadCases(only)).filter((c) => c.category === 'A');
  if (!cases.length) {
    console.log('No category A cases to parse.');
    return;
  }

  let failures = 0;
  for (const testCase of cases) {
    const outputPath = path.join(testCase.dir, 'reference', 'parsed.json');
    if (!force && (await exists(outputPath))) {
      console.log(`[${testCase.id}] already parsed`);
      continue;
    }

    const asset = (testCase.reference || [])[0];
    if (!asset) {
      console.log(`[${testCase.id}] no reference asset declared`);
      continue;
    }

    const pdfPath = path.join(testCase.dir, 'reference', asset.file);
    try {
      const slides = await parseSlidePdf(pdfPath);
      const parsed = {
        caseId: testCase.id,
        sourceFile: asset.file,
        slideCount: slides.length,
        totalWords: slides.reduce((sum, s) => sum + s.wordCount, 0),
        slides,
      };
      await fs.writeFile(outputPath, JSON.stringify(parsed, null, 2));
      console.log(
        `[${testCase.id}] ${slides.length} slides, ${parsed.totalWords} words ` +
          `(${Math.round(parsed.totalWords / Math.max(1, slides.length))}/slide)`
      );
    } catch (err) {
      failures += 1;
      console.error(`[${testCase.id}] failed: ${err.message}`);
    }
  }

  if (failures) process.exitCode = 1;
}

/**
 * Parse a slide-deck PDF into per-slide records.
 *
 * Each PDF page is one slide. The first substantial line of a page is treated
 * as its title -- crude, but it matches how slide decks are laid out and it is
 * the same rule applied to every reference deck, so comparisons stay fair.
 *
 * @param {string} pdfPath
 * @returns {Promise<{index: number, title: string, text: string, wordCount: number}[]>}
 */
async function parseSlidePdf(pdfPath) {
  const bytes = await fs.readFile(pdfPath);
  // The app's parser already returns text per page, which is what preserves
  // slide boundaries here.
  const { parsePdf } = await import('../../server/utils/convert-file/pdf-parser.js');
  const parsed = await parsePdf(bytes);
  if (!parsed.slides.length) {
    throw new Error(parsed.errors.join('; ') || 'no text extracted');
  }

  return parsed.slides.map(({ textContent: raw }, index) => {
    const lines = raw
      .split(/\s{3,}|\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    // Skip slide numbers and other one-token furniture when picking a title.
    const titleIndex = lines.findIndex((line) => line.length > 3 && !/^\d+$/.test(line));
    const title = titleIndex >= 0 ? lines[titleIndex] : '';
    const body = lines.filter((_, i) => i !== titleIndex).join('\n');
    const text = body.trim();

    return {
      index: index + 1,
      title,
      text,
      wordCount: [title, text].join(' ').split(/\s+/).filter(Boolean).length,
    };
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error(`Parse failed: ${err.message}`);
  process.exitCode = 1;
});
