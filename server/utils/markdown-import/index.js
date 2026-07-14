/**
 * Markdown Import - Public API
 *
 * Converts raw markdown text into the portable `slidecreator.deck` format,
 * ready for deckToPresentationParts().
 */

import JSZip from 'jszip';
import { parseMarkdownDeck } from './parse.js';
import { mapParsedDeckToSlides } from './map.js';
import { resolveSlideImages } from './images.js';
import { getMediaProvider } from '../../media/index.js';

/**
 * Convert markdown text to a deck object + import report.
 *
 * @param {string} markdown - Raw markdown text
 * @param {{ lang?: string, theme?: string, imageMap?: Map<string, string> }} opts
 * @returns {Promise<{ deck: object, report: object }>}
 */
export async function convertMarkdownText(markdown, opts = {}) {
  const report = {
    success: false,
    sourceFormat: 'markdown',
    slidesExtracted: 0,
    slidesConverted: 0,
    warnings: [],
    errors: [],
  };

  if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
    report.errors.push('No markdown content provided.');
    return { deck: null, report };
  }

  // 1. Parse
  let parsed;
  try {
    parsed = parseMarkdownDeck(markdown);
  } catch (err) {
    report.errors.push(`Markdown parsing failed: ${err.message}`);
    return { deck: null, report };
  }

  report.slidesExtracted = parsed.slides.length;

  // Forward parse-level warnings (broken syntax, etc.)
  if (parsed.warnings?.length > 0) {
    report.warnings.push(...parsed.warnings);
  }

  if (parsed.slides.length === 0) {
    report.errors.push('No slides found in the markdown. Use --- to separate slides.');
    return { deck: null, report };
  }

  // 2. Map to slide types
  let deck;
  try {
    deck = mapParsedDeckToSlides(parsed, {
      lang: opts.lang || parsed.meta?.lang,
      theme: opts.theme || parsed.meta?.theme,
      title: opts.title,
    });
  } catch (err) {
    report.errors.push(`Slide mapping failed: ${err.message}`);
    return { deck: null, report };
  }

  // 3. Resolve images
  try {
    await resolveSlideImages(deck.slides, { warnings: report.warnings, imageMap: opts.imageMap });
  } catch (err) {
    report.warnings.push(`Image resolution had errors: ${err.message}`);
  }

  report.slidesConverted = deck.slides.length;
  report.success = true;

  return { deck, report };
}

/**
 * Image file extensions recognized from zip bundles.
 */
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.bmp', '.ico',
]);

/**
 * Convert a zip bundle containing a .md file + images into a deck.
 *
 * @param {Buffer} zipBuffer - Raw zip file contents
 * @param {{ lang?: string, theme?: string }} opts
 * @returns {Promise<{ deck: object, report: object }>}
 */
export async function convertMarkdownBundle(zipBuffer, opts = {}) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = Object.keys(zip.files);

  // Find the .md file (root-level, first match)
  const mdEntry = entries.find((name) => {
    const lower = name.toLowerCase();
    return (lower.endsWith('.md') || lower.endsWith('.markdown')) && !zip.files[name].dir;
  });

  if (!mdEntry) {
    return {
      deck: null,
      report: {
        success: false,
        sourceFormat: 'zip',
        slidesExtracted: 0,
        slidesConverted: 0,
        warnings: [],
        errors: ['No .md file found in the zip bundle.'],
      },
    };
  }

  // Read the markdown text
  const markdown = await zip.files[mdEntry].async('string');

  // Extract and upload image files
  const imageMap = new Map();
  const provider = getMediaProvider();

  for (const name of entries) {
    if (zip.files[name].dir) continue;
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;

    try {
      const imageBuffer = await zip.files[name].async('nodebuffer');
      const result = await provider.uploadBuffer({
        buffer: imageBuffer,
        filename: name.split('/').pop(),
        contentType: guessImageMime(ext),
      });
      // Store with both the full path and the basename
      const url = result.publicUrl || '';
      if (url) {
        imageMap.set(name, url);
        // Also store without leading directory
        const basename = name.split('/').pop();
        if (basename !== name) {
          imageMap.set(basename, url);
        }
      }
    } catch (err) {
      console.warn(`[markdown-bundle] Failed to upload image ${name}:`, err.message);
    }
  }

  return convertMarkdownText(markdown, { ...opts, imageMap });
}

function guessImageMime(ext) {
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
  };
  return map[ext] || 'application/octet-stream';
}
