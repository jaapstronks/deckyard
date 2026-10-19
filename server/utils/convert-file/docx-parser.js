/**
 * Document Parser
 * Extracts text content from Word documents (.docx) and similar formats.
 * Uses mammoth for reliable text extraction.
 *
 * The text is marked up the way a report PDF is (B773, B774): a heading as
 * `#` per level, a list item as `- ` (or `1. ` in a numbered list), indented
 * two spaces per nesting level, so the model still sees the outline.
 *
 * An embedded picture stays where it stands, as an `[IMAGE n: …]` marker
 * (B775); its bytes come back as `figures`, uploaded only when the model
 * places it. Icons and bullets (under `MIN_IMAGE_PIXELS` on a side) stay out.
 */

import mammoth from 'mammoth';
import sharp from 'sharp';

import { MIN_IMAGE_PIXELS } from '../pdf-extract/images.js';
import { sourceImageMarker } from '../ai/source-images.js';
import { escapeHtml } from '../../../shared/slide-types/helpers.js';

/**
 * The `alt` a picture gets in mammoth's HTML, so the text can mark it.
 * mammoth writes `alt` first, so the number opens the tag.
 */
const FIGURE_TAG = /<img alt="docx-figure:(\d+)"[^>]*>/g;

/**
 * Extract a Word document as one marked-up text, preserving section order.
 * @param {Buffer} buffer - The document file contents
 * @returns {Promise<{document: string, figures: Array<{n: number, caption: string, pixels: {width: number, height: number}, buffer: Buffer, mimeType: string}>, metadata: object, errors: string[]}>}
 */
export async function parseDocx(buffer) {
  const errors = [];
  let document = '';
  const metadata = {};
  const figures = [];

  try {
    // Extract text with style information to detect headings
    const result = await mammoth.convertToHtml(
      { buffer },
      { convertImage: mammoth.images.imgElement(readFigure(figures)) },
    );

    if (result.messages?.length > 0) {
      for (const msg of result.messages) {
        if (msg.type === 'warning') {
          errors.push(`Warning: ${msg.message}`);
        }
      }
    }

    // Also get raw text for fallback
    const rawResult = await mammoth.extractRawText({ buffer });
    const rawText = rawResult.value || '';

    // Parse HTML to extract structure; a picture becomes its marker first
    const html = String(result.value || '').replace(FIGURE_TAG, (_, n) => {
      const figure = figures.find((f) => f.n === Number(n));
      return figure ? `<p>${escapeHtml(sourceImageMarker(figure))}</p>` : '';
    });
    const sections = parseHtmlToSections(markLists(html));

    document =
      sections
        .map((section) =>
          [section.heading, section.content].filter(Boolean).join('\n\n'),
        )
        .filter(Boolean)
        .join('\n\n') || rawText.trim();

    // The first heading or line names the document, not a source title slide.
    const firstLine = document.split('\n')[0].replace(/^#+ /, '').trim();
    if (firstLine && firstLine.length < 100) metadata.title = firstLine;
  } catch (e) {
    errors.push(`Error parsing document: ${e.message}`);
  }

  if (!document && errors.length === 0) {
    errors.push(
      'Could not extract any text from the document. It may be empty or protected.',
    );
  }

  return { document, figures, metadata, errors };
}

/**
 * The `convertImage` handler: keeps each picture of a usable size as a
 * numbered figure and tags its `<img>` with that number (its caption is
 * kept on the figure).
 * @param {Array<object>} figures - filled in document order
 */
function readFigure(figures) {
  return async (image) => {
    const data = await image.read();
    const { width = 0, height = 0 } = await sharp(data)
      .metadata()
      .catch(() => ({}));
    if (Math.min(width, height) < MIN_IMAGE_PIXELS) return { alt: '', src: '' };
    const n = figures.length + 1;
    figures.push({
      n,
      caption: String(image.altText || '').trim(),
      pixels: { width, height },
      buffer: data,
      mimeType: image.contentType || 'application/octet-stream',
    });
    return { alt: `docx-figure:${n}`, src: '' };
  };
}

/**
 * Parse HTML output from mammoth to extract sections based on headings.
 */
function parseHtmlToSections(html) {
  const sections = [];
  let currentSection = { heading: '', content: '' };

  // Simple HTML parsing - extract headings and content
  // Process parts: alternating between content and heading matches
  let lastIndex = 0;
  let match;
  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;

  while ((match = headingRegex.exec(html)) !== null) {
    // Get content before this heading
    const contentBefore = html.substring(lastIndex, match.index);
    const cleanedContent = stripHtml(contentBefore).trim();

    if (cleanedContent) {
      currentSection.content = cleanedContent;
    }

    // Save current section if it has content
    if (currentSection.heading || currentSection.content) {
      sections.push({ ...currentSection });
    }

    // Start new section with this heading, marked with its level
    currentSection = {
      heading: `${'#'.repeat(Number(match[1]))} ${stripHtml(match[2]).trim()}`,
      content: '',
    };

    lastIndex = match.index + match[0].length;
  }

  // Get remaining content after last heading
  const remainingContent = html.substring(lastIndex);
  const cleanedRemaining = stripHtml(remainingContent).trim();

  if (cleanedRemaining) {
    currentSection.content = cleanedRemaining;
  }

  // Save final section
  if (currentSection.heading || currentSection.content) {
    sections.push(currentSection);
  }

  // If no headings were found, treat the whole document as one section
  if (sections.length === 0 && html.trim()) {
    sections.push({
      heading: '',
      content: stripHtml(html).trim(),
    });
  }

  return sections;
}

/**
 * Turn mammoth's lists into marked lines: each `<li>` opens a line with its
 * marker, indented by its nesting depth. The rest of the markup is left for
 * `stripHtml()`.
 * @param {string} html
 * @returns {string}
 */
function markLists(html) {
  const lists = [];
  return html.replace(/<(\/?)(ul|ol|li)\b[^>]*>/gi, (_, close, tag) => {
    tag = tag.toLowerCase();
    if (tag !== 'li') {
      if (!close) {
        lists.push({ ordered: tag === 'ol', count: 0 });
        return '';
      }
      lists.pop();
      // a nested list ends inside its item; the next item opens its line
      return lists.length ? '' : '\n';
    }
    const list = lists.at(-1);
    if (close || !list) return '';
    list.count += 1;
    const marker = list.ordered ? `${list.count}.` : '-';
    return `\n${'  '.repeat(lists.length - 1)}${marker} `;
  });
}

/** Inline tags: removing them must not break the line they stand in. */
const INLINE_TAG = /^<\/?(?:a|b|strong|i|em|u|s|sub|sup|span)\b/i;

/**
 * Strip HTML tags and decode entities. A list line keeps its indentation.
 */
function stripHtml(html) {
  // Remove HTML tags: inline ones vanish, block ones end a line. Repeat until
  // nothing changes, so a removed tag cannot join the halves of another.
  let text = String(html || '');
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]+>/g, (tag) =>
      INLINE_TAG.test(tag) ? '' : '\n',
    );
  } while (text !== previous);
  return (
    text
      // Decode common entities — `&amp;` last, so `&amp;lt;` decodes to the
      // literal text `&lt;` instead of `<` (js/double-escaping)
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&amp;/g, '&')
      // Clean up whitespace
      .replace(/\t/g, ' ')
      .replace(/(?<=\S) {2,}/g, ' ')
      .replace(/ +\n/g, '\n')
      .replace(/\n +(?! |(?:-|\d+\.) )/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
