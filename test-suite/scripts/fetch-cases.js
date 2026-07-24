#!/usr/bin/env node
/**
 * Download and normalize test material.
 *
 * Source documents are not committed (licence terms vary and some are large),
 * so every case manifest records where its material came from and this script
 * fetches it. Originals are kept alongside a normalized .txt so a conversion
 * bug can be told apart from a bad download.
 *
 * Usage:
 *   node test-suite/scripts/fetch-cases.js [--cases a,b] [--force]
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadCases, sourceTextFilename } from '../lib/cases.js';
import { REPO_ROOT } from '../lib/config.js';

const USER_AGENT =
  'Deckyard-AI-test-suite/1.0 (evaluation harness; local use only; +https://github.com/jaapstronks/deckyard)';

async function main() {
  const argv = process.argv.slice(2);
  let only = null;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cases') only = argv[(i += 1)].split(',').map((s) => s.trim());
    else if (argv[i] === '--force') force = true;
  }

  const cases = await loadCases(only);
  let failures = 0;

  for (const testCase of cases) {
    console.log(`\n[${testCase.id}] ${testCase.title}`);
    const assets = [
      ...(testCase.sources || []).map((s) => ({ ...s, kind: 'source' })),
      ...(testCase.reference || []).map((s) => ({ ...s, kind: 'reference' })),
    ];

    for (const asset of assets) {
      const dir = path.join(testCase.dir, asset.kind);
      await fs.mkdir(dir, { recursive: true });
      const originalPath = path.join(dir, asset.file);
      const textPath = path.join(dir, sourceTextFilename(asset.file));

      if (!force && (await exists(textPath))) {
        console.log(`  · ${asset.file} (already present)`);
        continue;
      }

      try {
        // `local` assets come from the repo itself (the README meta-case), so
        // they always reflect the current checkout rather than a published copy.
        const bytes = asset.local
          ? await fs.readFile(path.join(REPO_ROOT, asset.local))
          : await download(asset.url, (asset.type || '').toLowerCase());
        await fs.writeFile(originalPath, bytes);

        const text = await toText(bytes, asset, originalPath);
        await fs.writeFile(textPath, text);
        console.log(
          `  ✓ ${asset.file} — ${formatBytes(bytes.length)} → ${countWords(text)} words`
        );
      } catch (err) {
        failures += 1;
        console.error(`  ✗ ${asset.file}: ${err.message}`);
      }
    }
  }

  if (failures) {
    console.error(`\n${failures} asset(s) failed. Fix the URLs in case.json and re-run.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll assets fetched.');
  }
}

/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function download(url, expectedType) {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  // Several publisher CDNs answer missing files with 200 + an HTML error page.
  // Status alone would let that be cached as a "PDF", so verify the payload.
  if (expectedType === 'pdf' && !bytes.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
    const contentType = response.headers.get('content-type') || 'unknown';
    throw new Error(`expected a PDF but got ${contentType} (likely a soft 404)`);
  }
  return bytes;
}

/**
 * Convert downloaded bytes into plain text for the pipeline.
 *
 * @param {Buffer} bytes
 * @param {{type: string, file: string}} asset
 * @param {string} originalPath
 * @returns {Promise<string>}
 */
async function toText(bytes, asset, originalPath) {
  const type = (asset.type || '').toLowerCase();

  if (type === 'pdf') {
    // Reuse the app's own PDF parser rather than a second pdf-parse binding.
    const { parsePdf } = await import('../../server/utils/convert-file/pdf-parser.js');
    const parsed = await parsePdf(bytes);
    if (!parsed.slides.length) {
      throw new Error(parsed.errors.join('; ') || 'no text extracted');
    }
    return cleanText(parsed.slides.map((page) => page.textContent).join('\n\n'));
  }

  if (type === 'html') {
    return cleanText(htmlToText(bytes.toString('utf8')));
  }

  if (type === 'wikitext') {
    return cleanText(wikitextToText(bytes.toString('utf8')));
  }

  if (type === 'text' || type === 'markdown') {
    return cleanText(bytes.toString('utf8'));
  }

  throw new Error(`Unsupported asset type "${asset.type}" for ${path.basename(originalPath)}`);
}

/**
 * Extract readable text from an HTML page, dropping chrome that would
 * otherwise dominate the source (navigation, scripts, cookie banners).
 *
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // Keep block structure as newlines so headings don't run into body text.
  return decodeEntities(
    withoutNoise
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<h([1-6])[^>]*>/gi, (_, level) => `\n${'#'.repeat(Number(level))} `)
      .replace(/<[^>]+>/g, ' ')
  );
}

/**
 * Strip wiki markup to readable prose.
 * @param {string} wikitext
 * @returns {string}
 */
function wikitextToText(wikitext) {
  return decodeEntities(
    wikitext
      // Templates and tables carry little presentable content and nest badly.
      .replace(/\{\{[^{}]*\}\}/g, ' ')
      .replace(/\{\{[^{}]*\}\}/g, ' ')
      .replace(/\{\|[\s\S]*?\|\}/g, ' ')
      .replace(/<ref[^>]*\/>/gi, ' ')
      .replace(/<ref[\s\S]*?<\/ref>/gi, ' ')
      .replace(/\[\[(?:File|Image|Bestand|Afbeelding):[^\]]*\]\]/gi, ' ')
      // [[target|label]] -> label; [[target]] -> target
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
      .replace(/\[https?:\/\/\S+\]/g, ' ')
      .replace(/^(=+)\s*(.*?)\s*\1\s*$/gm, (_, eq, title) => `\n${'#'.repeat(eq.length)} ${title}`)
      .replace(/'''''(.*?)'''''/g, '$1')
      .replace(/'''(.*?)'''/g, '$1')
      .replace(/''(.*?)''/g, '$1')
      .replace(/<[^>]+>/g, ' ')
  );
}

function decodeEntities(text) {
  const named = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&mdash;': '—',
    '&ndash;': '–',
    '&euro;': '€',
    '&hellip;': '…',
  };
  return text
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => {
      const lower = entity.toLowerCase();
      if (named[lower]) return named[lower];
      const numeric = entity.match(/&#(\d+);/);
      return numeric ? String.fromCodePoint(Number(numeric[1])) : ' ';
    });
}

/**
 * Collapse the whitespace damage that PDF and HTML extraction leave behind.
 * @param {string} text
 */
function cleanText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function formatBytes(n) {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} kB`;
}

main().catch((err) => {
  console.error(`Fetch failed: ${err.message}`);
  process.exitCode = 1;
});
