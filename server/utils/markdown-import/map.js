/**
 * Slide Type Mapper
 *
 * Takes a ParsedDeck from parse.js and maps each parsed slide to a Deckyard
 * slide type with populated content fields. Uses a two-pass strategy:
 *
 * 1. Explicit frontmatter `layout:` (highest priority)
 * 2. Content-based heuristics (heading patterns, images, tables, quotes, etc.)
 *
 * Output: a `slidecreator.deck` format object ready for deckToPresentationParts().
 */

import {
  LAYOUT_TO_SLIDE_TYPE,
  HEADING_RE,
  BLOCKQUOTE_LINE_RE,
  ATTRIBUTION_RE,
  BOLD_COLON_RE,
} from './constants.js';

/**
 * Convert a ParsedDeck into the portable deck format.
 * @param {{ meta: Record<string, any>, slides: import('./parse.js').ParsedSlide[] }} parsed
 * @param {{ lang?: string, theme?: string }} opts
 * @returns {{ format: string, version: number, title: string, theme: string, slides: object[] }}
 */
export function mapParsedDeckToSlides(parsed, opts = {}) {
  const { meta, slides } = parsed;

  const theme = opts.theme || String(meta.theme || 'default');
  const title = String(meta.title || opts.title || 'Imported presentation');

  const mappedSlides = slides.map((s, i) => mapSingleSlide(s, i, slides.length));

  return {
    format: 'slidecreator.deck',
    version: 1,
    title,
    theme,
    slides: mappedSlides,
  };
}

// ---------------------------------------------------------------------------
// Single slide mapping
// ---------------------------------------------------------------------------

function mapSingleSlide(parsed, slideIndex, totalSlides) {
  // Pass 1: Explicit layout from frontmatter
  const layout = parsed.frontmatter?.layout;
  if (layout) {
    const key = String(layout).toLowerCase().trim();
    const mapping = LAYOUT_TO_SLIDE_TYPE[key];
    if (mapping) {
      return buildSlide(mapping.type, parsed, mapping.content || {});
    }
  }

  // Pass 1b: Apply Slidev/Marp directive mappings from frontmatter
  const directiveOverrides = applyDirectiveMappings(parsed.frontmatter);

  // Pass 2: Content-based heuristics (first match wins)

  // 2a. First slide with only a heading (+ optional subtitle) -> title-slide
  if (slideIndex === 0 && isHeadingOnly(parsed)) {
    return buildTitleSlide(parsed, directiveOverrides);
  }

  // 2b. Heading only, no body -> chapter-title-slide
  if (isHeadingOnly(parsed) && slideIndex > 0) {
    return buildChapterSlide(parsed, directiveOverrides);
  }

  // 2c. Blockquote present -> quote-slide
  if (parsed.hasBlockquote) {
    return buildQuoteSlide(parsed, directiveOverrides);
  }

  // 2d. Multiple images (3+) with minimal text -> gallery-slide
  if (isGallery(parsed)) {
    return buildGallerySlide(parsed, directiveOverrides);
  }

  // 2e. Image only (no meaningful text body) -> image-slide
  if (parsed.images.length > 0 && isImageOnly(parsed)) {
    return buildImageSlide(parsed, directiveOverrides);
  }

  // 2f. Image + heading + body -> image-text-slide
  if (parsed.images.length > 0 && parsed.headings.length > 0) {
    return buildImageTextSlide(parsed, directiveOverrides);
  }

  // 2g. Column markers with headings per column -> comparison-slide
  if (parsed.hasColumns && hasColumnHeadings(parsed)) {
    return buildComparisonSlide(parsed, directiveOverrides);
  }

  // 2h. Column markers without headings -> content-slide (two-column)
  if (parsed.hasColumns) {
    return buildTwoColumnContentSlide(parsed, directiveOverrides);
  }

  // 2i. Pipe table -> table-slide
  if (parsed.hasTable) {
    return buildTableSlide(parsed, directiveOverrides);
  }

  // 2j. CSV/TSV code block -> chart-slide
  if (hasChartCodeBlock(parsed)) {
    return buildChartSlide(parsed, directiveOverrides);
  }

  // 2k. Code block only (minimal other text) -> content-slide with code
  if (isCodeBlockOnly(parsed)) {
    return buildCodeSlide(parsed, directiveOverrides);
  }

  // 2l. Bullet list with **bold**: description pattern -> lijstje-slide
  if (isBoldColonList(parsed)) {
    return buildLijstjeSlide(parsed, directiveOverrides);
  }

  // 2m. Default -> content-slide (one-column)
  return buildContentSlide(parsed, directiveOverrides);
}

// ---------------------------------------------------------------------------
// Heuristic helpers
// ---------------------------------------------------------------------------

function isHeadingOnly(parsed) {
  const body = parsed.body;
  const lines = body.split('\n').filter((l) => l.trim());
  // All non-empty lines are headings or very short (byline-like)
  const nonHeadingLines = lines.filter((l) => {
    const trimmed = l.trim();
    return !HEADING_RE.test(trimmed) && trimmed.length > 0;
  });
  // Allow up to 1 non-heading line (subtitle/byline)
  return parsed.headings.length > 0 && nonHeadingLines.length <= 1;
}

function isImageOnly(parsed) {
  // Body contains image markdown but essentially no other text
  const bodyWithoutImages = parsed.body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .trim();
  const lines = bodyWithoutImages.split('\n').filter((l) => l.trim());
  // Allow a heading (caption) but no substantial paragraph text
  const nonHeadingLines = lines.filter((l) => !HEADING_RE.test(l.trim()));
  return nonHeadingLines.length === 0;
}

function hasColumnHeadings(parsed) {
  if (!parsed.columns) return false;
  const leftHasHeading = HEADING_RE.test(parsed.columns.left.split('\n')[0]?.trim() || '');
  const rightHasHeading = HEADING_RE.test(parsed.columns.right.split('\n')[0]?.trim() || '');
  return leftHasHeading || rightHasHeading;
}

function isBoldColonList(parsed) {
  const lines = parsed.body.split('\n').filter((l) => l.trim());
  const listLines = lines.filter((l) => l.trim().startsWith('-') || l.trim().startsWith('*'));
  if (listLines.length < 2) return false;
  const boldColonLines = listLines.filter((l) => {
    const content = l.trim().replace(/^[-*]\s*/, '');
    return BOLD_COLON_RE.test(content);
  });
  // At least 2 items and majority match the pattern
  return boldColonLines.length >= 2 && boldColonLines.length / listLines.length >= 0.5;
}

function isGallery(parsed) {
  // 3+ images with minimal non-image text
  if (parsed.images.length < 3) return false;
  const bodyWithoutImages = parsed.body
    .replace(/!\[[^\]]*\]\([^)]*(?:\s+"[^"]*")?\)/g, '')
    .trim();
  const lines = bodyWithoutImages.split('\n').filter((l) => l.trim());
  const nonHeadingLines = lines.filter((l) => !HEADING_RE.test(l.trim()));
  return nonHeadingLines.length === 0;
}

function isCodeBlockOnly(parsed) {
  // Slide has code blocks and minimal other text
  if (parsed.codeBlocks.length === 0) return false;
  // Strip code blocks from body and check what remains
  let bodyWithoutCode = parsed.body;
  for (const block of parsed.codeBlocks) {
    // Remove the fenced code block pattern from body
    bodyWithoutCode = bodyWithoutCode.replace(/```[\s\S]*?```/g, '');
  }
  bodyWithoutCode = bodyWithoutCode.trim();
  const lines = bodyWithoutCode.split('\n').filter((l) => l.trim());
  const nonHeadingLines = lines.filter((l) => !HEADING_RE.test(l.trim()));
  return nonHeadingLines.length <= 1;
}

function hasChartCodeBlock(parsed) {
  return parsed.codeBlocks.some((b) => b.lang === 'csv' || b.lang === 'tsv');
}

// ---------------------------------------------------------------------------
// Slide builders
// ---------------------------------------------------------------------------

function buildSlide(type, parsed, contentOverrides = {}) {
  // Route to specific builders where we have structured extraction
  switch (type) {
    case 'title-slide':       return buildTitleSlide(parsed, contentOverrides);
    case 'chapter-title-slide': return buildChapterSlide(parsed, contentOverrides);
    case 'quote-slide':       return buildQuoteSlide(parsed, contentOverrides);
    case 'image-slide':       return buildImageSlide(parsed, contentOverrides);
    case 'image-text-slide':  return buildImageTextSlide(parsed, contentOverrides);
    case 'comparison-slide':  return buildComparisonSlide(parsed, contentOverrides);
    case 'table-slide':       return buildTableSlide(parsed, contentOverrides);
    case 'lijstje-slide':     return buildLijstjeSlide(parsed, contentOverrides);
    case 'payoff-slide':      return buildPayoffSlide(parsed, contentOverrides);
    case 'chart-slide':       return buildChartSlide(parsed, contentOverrides);
    case 'kpi-metrics-slide': return buildKpiSlide(parsed, contentOverrides);
    case 'gallery-slide':     return buildGallerySlide(parsed, contentOverrides);
    case 'content-slide': {
      if (contentOverrides.layout === 'two-column') {
        return buildTwoColumnContentSlide(parsed, contentOverrides);
      }
      return buildContentSlide(parsed, contentOverrides);
    }
    default:
      return buildContentSlide(parsed, contentOverrides);
  }
}

function buildTitleSlide(parsed, overrides = {}) {
  const h1 = parsed.headings.find((h) => h.level === 1);
  const h2 = parsed.headings.find((h) => h.level === 2);
  const nonHeadingLines = parsed.body
    .split('\n')
    .filter((l) => l.trim() && !HEADING_RE.test(l.trim()));
  const byline = nonHeadingLines[0]?.trim() || '';

  const bgImage = parsed.frontmatter?.background || '';

  const content = {
    title: h1?.text || parsed.headings[0]?.text || 'Untitled',
    subheading: h2?.text || '',
    byline: byline,
    bgImage: typeof bgImage === 'string' ? bgImage : '',
    ...overrides,
  };

  return slide('title-slide', content, parsed.notes);
}

function buildChapterSlide(parsed, overrides = {}) {
  const heading = parsed.headings[0]?.text || 'Section';
  return slide('chapter-title-slide', {
    title: heading,
    ...overrides,
  }, parsed.notes);
}

function buildQuoteSlide(parsed, overrides = {}) {
  const lines = parsed.body.split('\n');
  const quoteLines = [];
  let authorName = '';
  let authorTitle = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (BLOCKQUOTE_LINE_RE.test(trimmed)) {
      const content = trimmed.replace(/^>\s?/, '').trim();
      // Check for attribution: `-- Author, Title`
      const attrMatch = content.match(ATTRIBUTION_RE);
      if (attrMatch) {
        const parts = attrMatch[1].split(',').map((s) => s.trim());
        authorName = parts[0] || '';
        authorTitle = parts.slice(1).join(', ') || '';
      } else if (content) {
        quoteLines.push(content);
      }
    }
  }

  // Clean up quote text: remove surrounding quotes
  let quoteText = quoteLines.join(' ').trim();
  quoteText = quoteText.replace(/^[""\u201C]+|[""\u201D]+$/g, '').trim();

  return slide('quote-slide', {
    quote: quoteText || 'Quote',
    authorName: authorName,
    authorTitle: authorTitle,
    ...overrides,
  }, parsed.notes);
}

function buildImageSlide(parsed, overrides = {}) {
  const img = parsed.images[0] || {};
  const heading = parsed.headings[0];

  return slide('image-slide', {
    title: heading?.text || '',
    image: img.src || '',
    alt: img.alt || '',
    caption: img.caption || '',
    ...overrides,
  }, parsed.notes);
}

function buildImageTextSlide(parsed, overrides = {}) {
  const img = parsed.images[0] || {};
  const heading = parsed.headings[0];

  // Body without the image markdown and the first heading
  let bodyText = parsed.body;
  // Remove image syntax
  bodyText = bodyText.replace(/!\[[^\]]*\]\([^)]*(?:\s+"[^"]*")?\)/g, '').trim();
  // Remove first heading
  if (heading) {
    bodyText = bodyText.replace(new RegExp(`^#{1,6}\\s+${escapeRegex(heading.text)}`, 'm'), '').trim();
  }

  return slide('image-text-slide', {
    title: heading?.text || '',
    body: bodyText || '',
    image: img.src || '',
    alt: img.alt || '',
    caption: img.caption || '',
    imageSide: overrides.imageSide || 'left',
    ...overrides,
  }, parsed.notes);
}

function buildComparisonSlide(parsed, overrides = {}) {
  const { left, right } = parsed.columns || { left: '', right: '' };

  // Extract heading + rest from each column
  const leftParts = splitColumnContent(left);
  const rightParts = splitColumnContent(right);

  // Overall heading (before column markers)
  const heading = getPreColumnHeading(parsed);

  return slide('comparison-slide', {
    title: heading || '',
    leftTitle: leftParts.title || '',
    leftBody: leftParts.body || '',
    rightTitle: rightParts.title || '',
    rightBody: rightParts.body || '',
    ...overrides,
  }, parsed.notes);
}

function buildTwoColumnContentSlide(parsed, overrides = {}) {
  const heading = getPreColumnHeading(parsed);
  // Combine left + right into a single body with column separator hint.
  // The content-slide with layout:two-column will split at the middle.
  const { left, right } = parsed.columns || { left: '', right: '' };
  const body = left + '\n\n' + right;

  return slide('content-slide', {
    title: heading || '',
    body: body.trim(),
    layout: 'two-column',
    ...overrides,
  }, parsed.notes);
}

function buildTableSlide(parsed, overrides = {}) {
  const heading = parsed.headings[0];
  const tableData = parseMarkdownTable(parsed.body);

  return slide('table-slide', {
    title: heading?.text || '',
    headerRow: tableData.hasHeader ? 'on' : 'off',
    colCount: String(tableData.colCount),
    rows: tableData.rows,
    ...overrides,
  }, parsed.notes);
}

function buildLijstjeSlide(parsed, overrides = {}) {
  const heading = parsed.headings[0];
  const items = [];

  // Use parsed listItems if available (preserves nesting)
  const listItems = parsed.listItems || [];
  const hasNesting = listItems.some((li) => li.level > 0);

  if (hasNesting && listItems.length > 0) {
    // Build nested structure: sub-items are appended to parent's text
    let currentParent = null;
    for (const li of listItems) {
      const m = li.text.match(BOLD_COLON_RE);
      if (li.level === 0) {
        if (m) {
          currentParent = { title: m[1].trim(), text: m[2].trim() };
        } else {
          currentParent = { title: li.text, text: '' };
        }
        items.push(currentParent);
      } else if (currentParent) {
        // Append sub-item to parent's text
        const subText = li.text;
        currentParent.text = currentParent.text
          ? currentParent.text + '\n' + '  '.repeat(li.level) + '- ' + subText
          : '  '.repeat(li.level) + '- ' + subText;
      } else {
        // Orphan sub-item (no parent), treat as top-level
        items.push({ title: li.text, text: '' });
      }
    }
  } else {
    // Flat list (original behavior)
    for (const line of parsed.body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('-') && !trimmed.startsWith('*')) continue;
      const content = trimmed.replace(/^[-*]\s*/, '');
      const m = content.match(BOLD_COLON_RE);
      if (m) {
        items.push({ title: m[1].trim(), text: m[2].trim() });
      } else {
        items.push({ title: content, text: '' });
      }
    }
  }

  return slide('lijstje-slide', {
    title: heading?.text || '',
    items: items.slice(0, 8), // max 8 items
    ...overrides,
  }, parsed.notes);
}

function buildPayoffSlide(_parsed, overrides = {}) {
  return slide('payoff-slide', { ...overrides }, _parsed.notes);
}

function buildChartSlide(parsed, overrides = {}) {
  const heading = parsed.headings[0];
  // Look for CSV data in a code block
  const csvBlock = parsed.codeBlocks.find(
    (b) => b.lang === 'csv' || b.lang === 'tsv' || b.lang === ''
  );

  return slide('chart-slide', {
    title: heading?.text || '',
    chartType: parsed.frontmatter?.chartType || 'bar',
    data: csvBlock?.code || parsed.frontmatter?.data || '',
    ...overrides,
  }, parsed.notes);
}

function buildKpiSlide(parsed, overrides = {}) {
  const heading = parsed.headings[0];
  // KPI data can come from frontmatter (deferred: requires richer YAML)
  return slide('kpi-metrics-slide', {
    title: heading?.text || '',
    ...overrides,
  }, parsed.notes);
}

function buildGallerySlide(parsed, overrides = {}) {
  const heading = parsed.headings[0];
  const images = parsed.images.map((img) => ({
    src: img.src || '',
    alt: img.alt || '',
    caption: img.caption || '',
  }));

  return slide('gallery-slide', {
    title: heading?.text || '',
    images: images.slice(0, 12), // max 12 images
    ...overrides,
  }, parsed.notes);
}

function buildCodeSlide(parsed, overrides = {}) {
  const heading = parsed.headings[0];

  // Collect code blocks into the body, preserving language markers
  const codeBody = parsed.codeBlocks.map((block) => {
    const langTag = block.lang ? `\`\`\`${block.lang}` : '```';
    return `${langTag}\n${block.code}\`\`\``;
  }).join('\n\n');

  // Combine any non-code text with the code blocks
  let bodyText = parsed.body;
  if (heading) {
    bodyText = bodyText.replace(new RegExp(`^#{1,6}\\s+${escapeRegex(heading.text)}`, 'm'), '').trim();
  }

  return slide('content-slide', {
    title: heading?.text || '',
    body: bodyText || codeBody || '',
    layout: 'one-column',
    ...overrides,
  }, parsed.notes);
}

function buildContentSlide(parsed, overrides = {}) {
  const heading = parsed.headings[0];

  let bodyText = parsed.body;
  // Remove first heading from body
  if (heading) {
    bodyText = bodyText.replace(new RegExp(`^#{1,6}\\s+${escapeRegex(heading.text)}`, 'm'), '').trim();
  }

  return slide('content-slide', {
    title: heading?.text || '',
    body: bodyText || '',
    layout: 'one-column',
    ...overrides,
  }, parsed.notes);
}

// ---------------------------------------------------------------------------
// Slidev/Marp Directive Mappings
// ---------------------------------------------------------------------------

/**
 * Map Slidev/Marp frontmatter directives to slide content field overrides.
 * @param {Record<string, any>} frontmatter
 * @returns {Record<string, any>} Content overrides
 */
function applyDirectiveMappings(frontmatter) {
  if (!frontmatter) return {};
  const overrides = {};

  // background: → bgImage (Slidev/Marp)
  const bg = frontmatter.background || frontmatter.image;
  if (typeof bg === 'string' && bg.trim()) {
    overrides.bgImage = bg.trim();
  }

  // backgroundColor: / color: → metadata fields
  if (typeof frontmatter.backgroundColor === 'string') {
    overrides._backgroundColor = frontmatter.backgroundColor;
  }
  if (typeof frontmatter.color === 'string') {
    overrides._color = frontmatter.color;
  }

  // transition: → metadata
  if (typeof frontmatter.transition === 'string') {
    overrides._transition = frontmatter.transition;
  }

  // class: → metadata (Slidev)
  if (typeof frontmatter.class === 'string') {
    overrides._class = frontmatter.class;
  }

  return overrides;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function slide(type, content, notes) {
  const s = { type, content };
  if (notes) s.notes = notes;
  return s;
}

/**
 * Get the heading that appears before column markers in the body.
 */
function getPreColumnHeading(parsed) {
  const lines = parsed.body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^::(\w+)::$/)) break; // column marker reached
    const hm = trimmed.match(HEADING_RE);
    if (hm) return hm[2].trim();
  }
  return '';
}

/**
 * Split column content into heading + body.
 */
function splitColumnContent(text) {
  const lines = text.split('\n');
  let title = '';
  const bodyLines = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const hm = trimmed.match(HEADING_RE);
    if (hm && !title) {
      title = hm[2].trim();
    } else {
      bodyLines.push(lines[i]);
    }
  }

  return { title, body: bodyLines.join('\n').trim() };
}

/**
 * Parse a markdown pipe table into rows for table-slide.
 * Returns { hasHeader, colCount, rows } where each row is { c1, c2, ... }.
 */
function parseMarkdownTable(body) {
  const lines = body.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length === 0) return { hasHeader: false, colCount: 0, rows: [] };

  const parsedRows = lines.map((line) => {
    // Split on | and trim. Leading/trailing | produce empty strings at edges.
    const raw = line.split('|').map((c) => c.trim());
    // Remove empty first and last entries from leading/trailing pipes
    if (raw.length > 0 && raw[0] === '') raw.shift();
    if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
    return raw;
  });

  // Detect separator row (e.g., |---|---|)
  let hasHeader = false;
  let dataRows = parsedRows;
  if (parsedRows.length >= 2) {
    const secondRow = parsedRows[1];
    const isSeparator = secondRow.every((cell) => /^[-:]+$/.test(cell));
    if (isSeparator) {
      hasHeader = true;
      // Header is first row, skip separator, rest is data
      dataRows = [parsedRows[0], ...parsedRows.slice(2)];
    }
  }

  const colCount = Math.max(...dataRows.map((r) => r.length), 0);
  const rows = dataRows.map((cells) => {
    const row = {};
    for (let i = 0; i < colCount; i++) {
      row[`c${i + 1}`] = cells[i] || '';
    }
    return row;
  });

  return { hasHeader, colCount: Math.min(colCount, 10), rows: rows.slice(0, 40) };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
