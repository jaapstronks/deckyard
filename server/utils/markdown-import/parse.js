/**
 * Markdown Deck Parser
 *
 * Splits markdown text on `---` separators, extracts per-slide frontmatter,
 * speaker notes, images, columns, tables, blockquotes, and code blocks.
 *
 * Output: ParsedDeck object consumed by map.js.
 */

import { parseSimpleYaml } from './yaml-lite.js';
import {
  SLIDE_SEPARATOR,
  DECK_META_KEYS,
  COLUMN_MARKER_RE,
  HTML_COMMENT_NOTES_RE,
  NOTE_PREFIX_RE,
  IMAGE_RE,
  CODE_BLOCK_RE,
  PIPE_TABLE_RE,
  BLOCKQUOTE_LINE_RE,
  HEADING_RE,
} from './constants.js';

/**
 * @typedef {object} ParsedImage
 * @property {string} alt
 * @property {string} src
 * @property {string} caption
 */

/**
 * @typedef {object} ParsedCodeBlock
 * @property {string} lang
 * @property {string} highlights - e.g. "2,3|5-6"
 * @property {string} code
 */

/**
 * @typedef {object} ParsedSlide
 * @property {number} index - 0-based position in the deck
 * @property {Record<string, any>} frontmatter - Per-slide YAML
 * @property {string} body - Markdown body (frontmatter and notes stripped)
 * @property {string} notes - Speaker notes
 * @property {ParsedImage[]} images
 * @property {ParsedCodeBlock[]} codeBlocks
 * @property {boolean} hasTable
 * @property {boolean} hasBlockquote
 * @property {boolean} hasColumns
 * @property {{ left: string, right: string } | null} columns - Split content if `::left::`/`::right::` present
 * @property {string[]} headings - Array of heading texts (level stored via prefix)
 */

/**
 * @typedef {object} ParsedDeck
 * @property {Record<string, any>} meta - Global frontmatter (title, theme, lang)
 * @property {ParsedSlide[]} slides
 */

/**
 * Parse a full markdown deck string into structured data.
 * @param {string} md - Raw markdown text
 * @returns {ParsedDeck}
 */
export function parseMarkdownDeck(md) {
  if (!md || typeof md !== 'string') {
    return { meta: {}, slides: [] };
  }

  const rawBlocks = splitOnSeparator(md);

  // First block may be global frontmatter (YAML between opening `---` fences).
  // When markdown starts with `---`, splitOnSeparator produces:
  //   rawBlocks[0] = '' (empty, before the opening ---)
  //   rawBlocks[1] = YAML content (between opening --- and next ---)
  //   rawBlocks[2+] = slide content
  let meta = {};
  let slideBlocks = rawBlocks;

  if (md.trimStart().startsWith(SLIDE_SEPARATOR) && rawBlocks.length >= 2) {
    const firstBlock = rawBlocks[0].trim();
    const secondBlock = rawBlocks[1].trim();

    if (firstBlock === '' && secondBlock && looksLikeYaml(secondBlock)) {
      // Standard frontmatter: ---\nyaml\n---
      meta = parseSimpleYaml(secondBlock);
      slideBlocks = rawBlocks.slice(2);
    } else if (firstBlock && looksLikeYaml(firstBlock)) {
      // Less common: YAML before first --- (no opening fence)
      meta = parseSimpleYaml(firstBlock);
      slideBlocks = rawBlocks.slice(1);
    }
  }

  // Extract deck-level meta keys (title, theme, lang) and leave the rest
  const deckMeta = {};
  for (const key of DECK_META_KEYS) {
    if (meta[key] !== undefined) {
      deckMeta[key] = meta[key];
      delete meta[key];
    }
  }
  // Normalize `language` alias
  if (deckMeta.language && !deckMeta.lang) {
    deckMeta.lang = deckMeta.language;
    delete deckMeta.language;
  }

  // Parse each remaining block as a slide
  const slides = [];
  const warnings = [];
  for (let i = 0; i < slideBlocks.length; i++) {
    const block = slideBlocks[i];
    // Skip entirely empty blocks (e.g. double `---`)
    if (!block.trim()) continue;
    const slide = parseSlideBlock(block, slides.length);
    if (slide.warnings.length > 0) {
      warnings.push(...slide.warnings);
    }
    slides.push(slide);
  }

  return { meta: deckMeta, slides, warnings };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split markdown on `---` lines (horizontal rules / slide separators).
 * Preserves content between separators. A `---` inside a fenced code block
 * is NOT treated as a separator.
 */
function splitOnSeparator(md) {
  const blocks = [];
  let current = [];
  let inCodeFence = false;

  for (const line of md.split('\n')) {
    // Track fenced code blocks so we don't split inside them
    if (line.trimStart().startsWith('```')) {
      inCodeFence = !inCodeFence;
    }

    if (!inCodeFence && line.trim() === SLIDE_SEPARATOR) {
      blocks.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  // Last block
  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }
  return blocks;
}

/**
 * Heuristic: does this block look like pure YAML (key: value pairs)
 * rather than slide content (headings, paragraphs, images)?
 */
function looksLikeYaml(block) {
  const lines = block.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length === 0) return false;
  // If >60% of non-empty lines contain a colon, treat as YAML
  const colonLines = lines.filter((l) => l.includes(':'));
  return colonLines.length / lines.length > 0.5;
}

/**
 * Parse a single slide block (between two `---` separators).
 */
function parseSlideBlock(block, index) {
  let body = block;
  let frontmatter = {};

  // Check for per-slide frontmatter: block starts with YAML-like lines
  // before the first blank line or markdown element.
  const fmResult = extractFrontmatter(body);
  if (fmResult) {
    frontmatter = fmResult.frontmatter;
    body = fmResult.rest;
  }

  // Extract speaker notes
  let notes = '';
  ({ body, notes } = extractNotes(body));

  // Extract images
  const images = extractImages(body);

  // Extract code blocks
  const codeBlocks = extractCodeBlocks(body);

  // Detect features
  const hasTable = PIPE_TABLE_RE.test(body);
  const hasBlockquote = body.split('\n').some((l) => BLOCKQUOTE_LINE_RE.test(l.trim()));

  // Columns
  const columns = extractColumns(body);
  const hasColumns = columns !== null;

  // Headings
  const headings = [];
  for (const line of body.split('\n')) {
    const m = line.trim().match(HEADING_RE);
    if (m) headings.push({ level: m[1].length, text: m[2].trim() });
  }

  // List items with indentation levels
  const listItems = extractListItems(body);

  // Detect broken markdown patterns that might indicate typos
  const warnings = detectBrokenPatterns(body, index);

  return {
    index,
    frontmatter,
    body: body.trim(),
    notes: notes.trim(),
    images,
    codeBlocks,
    hasTable,
    hasBlockquote,
    hasColumns,
    columns,
    headings,
    listItems,
    warnings,
  };
}

/**
 * Try to extract per-slide frontmatter from the start of a block.
 * Per-slide frontmatter is lines of `key: value` at the very top,
 * ending at the first blank line or first non-YAML line (heading, list, etc.).
 */
function extractFrontmatter(body) {
  const lines = body.split('\n');
  const yamlLines = [];
  let restStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Blank line ends frontmatter region
    if (trimmed === '') {
      if (yamlLines.length > 0) {
        restStartIdx = i;
        break;
      }
      // Leading blank lines - skip
      restStartIdx = i + 1;
      continue;
    }

    // A line with `key: value` pattern (but NOT a heading like `## Title`)
    if (trimmed.includes(':') && !trimmed.startsWith('#') && !trimmed.startsWith('-') && !trimmed.startsWith('>') && !trimmed.startsWith('|') && !trimmed.startsWith('!')) {
      yamlLines.push(trimmed);
      restStartIdx = i + 1;
    } else {
      // First non-YAML line, stop
      break;
    }
  }

  if (yamlLines.length === 0) return null;

  return {
    frontmatter: parseSimpleYaml(yamlLines.join('\n')),
    rest: lines.slice(restStartIdx).join('\n'),
  };
}

/**
 * Extract speaker notes from body.
 * Supports HTML comment `<!-- notes -->` and `Note:` prefix.
 */
function extractNotes(body) {
  let notes = '';

  // 1. HTML comments <!-- ... -->
  const commentNotes = [];
  body = body.replace(HTML_COMMENT_NOTES_RE, (_match, content) => {
    commentNotes.push(content.trim());
    return '';
  });
  if (commentNotes.length > 0) {
    notes = commentNotes.join('\n');
  }

  // 2. Note: prefix (after blank line, runs to end of body)
  const noteMatch = body.match(NOTE_PREFIX_RE);
  if (noteMatch) {
    const noteContent = noteMatch[1].trim();
    if (noteContent) {
      notes = notes ? notes + '\n' + noteContent : noteContent;
    }
    body = body.slice(0, noteMatch.index).trimEnd();
  }

  return { body, notes };
}

/**
 * Extract markdown images from body text.
 */
function extractImages(body) {
  const images = [];
  let match;
  const re = new RegExp(IMAGE_RE.source, IMAGE_RE.flags);
  while ((match = re.exec(body)) !== null) {
    images.push({
      alt: match[1] || '',
      src: match[2] || '',
      caption: match[3] || '',
    });
  }
  return images;
}

/**
 * Extract fenced code blocks.
 */
function extractCodeBlocks(body) {
  const blocks = [];
  let match;
  const re = new RegExp(CODE_BLOCK_RE.source, CODE_BLOCK_RE.flags);
  while ((match = re.exec(body)) !== null) {
    blocks.push({
      lang: match[1] || '',
      highlights: match[2] || '',
      code: match[3] || '',
    });
  }
  return blocks;
}

/**
 * Extract `::left::` / `::right::` column markers and split content.
 * Returns null if no column markers found.
 */
function extractColumns(body) {
  const lines = body.split('\n');
  let leftLines = [];
  let rightLines = [];
  let current = null; // null = before any marker, 'left' or 'right'

  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(COLUMN_MARKER_RE);
    if (m) {
      const marker = m[1].toLowerCase();
      if (marker === 'left') {
        current = 'left';
        continue;
      }
      if (marker === 'right') {
        current = 'right';
        continue;
      }
    }
    if (current === 'left') leftLines.push(line);
    else if (current === 'right') rightLines.push(line);
  }

  if (leftLines.length === 0 && rightLines.length === 0) return null;

  return {
    left: leftLines.join('\n').trim(),
    right: rightLines.join('\n').trim(),
  };
}

/**
 * Extract list items with indentation levels.
 * Detects `-` and `*` list markers, measuring indent depth.
 * @param {string} body
 * @returns {{ level: number, text: string }[]}
 */
function extractListItems(body) {
  const items = [];
  for (const line of body.split('\n')) {
    // Match list items: optional leading whitespace + `-` or `*` + space + text
    const m = line.match(/^(\s*)([-*])\s+(.*)/);
    if (!m) continue;
    const indent = m[1].length;
    // level 0 = no indent, level 1 = 2-3 spaces, level 2 = 4-5, etc.
    const level = Math.floor(indent / 2);
    items.push({ level, text: m[3].trim() });
  }
  return items;
}

/**
 * Detect broken or malformed markdown patterns that likely indicate typos.
 * Returns an array of human-readable warning strings.
 */
function detectBrokenPatterns(body, slideIndex) {
  const warnings = [];
  const slideNum = slideIndex + 1;

  for (const line of body.split('\n')) {
    const trimmed = line.trim();

    // Broken image: `![alt]url)` — missing opening paren
    if (/!\[[^\]]*\][^(]/.test(trimmed) && /!\[/.test(trimmed)) {
      // Make sure it's not a valid image (which would have `](`)
      if (!(/!\[[^\]]*\]\(/.test(trimmed))) {
        warnings.push(
          `Slide ${slideNum}: Broken image syntax — looks like a missing "(" in "${truncate(trimmed, 80)}"`
        );
      }
    }

    // Broken image: `![alt](url` — missing closing paren
    if (/!\[[^\]]*\]\([^)]+$/.test(trimmed)) {
      warnings.push(
        `Slide ${slideNum}: Broken image syntax — looks like a missing ")" in "${truncate(trimmed, 80)}"`
      );
    }

    // Broken link: `[text]url)` — missing opening paren (not an image)
    if (!/!\[/.test(trimmed) && /\[[^\]]+\][^(!\[]/.test(trimmed) && !trimmed.includes('](') && /\]\s*http/.test(trimmed)) {
      warnings.push(
        `Slide ${slideNum}: Broken link syntax — looks like a missing "(" in "${truncate(trimmed, 80)}"`
      );
    }

    // Unclosed image alt: `![text` without closing `]`
    if (/!\[[^\]]*$/.test(trimmed)) {
      warnings.push(
        `Slide ${slideNum}: Unclosed image alt text — missing "]" in "${truncate(trimmed, 80)}"`
      );
    }
  }

  return warnings;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}
