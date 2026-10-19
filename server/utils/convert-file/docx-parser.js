/**
 * Document Parser
 * Extracts text content from Word documents (.docx) and similar formats.
 * Uses mammoth for reliable text extraction.
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
 * Extract text content from a Word document, attempting to identify sections.
 * Each major section (based on headings) is treated as a potential slide.
 * @param {Buffer} buffer - The document file contents
 * @returns {Promise<{slides: Array<{slideNumber: number, textContent: string}>, figures: Array<{n: number, caption: string, pixels: {width: number, height: number}, buffer: Buffer, mimeType: string}>, metadata: object, errors: string[]}>}
 */
export async function parseDocx(buffer) {
  const errors = [];
  const slides = [];
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
    const sections = parseHtmlToSections(html);

    if (sections.length > 0) {
      // Use structured sections
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        let textContent = '';

        if (section.heading) {
          textContent += section.heading + '\n\n';
        }
        if (section.content) {
          textContent += section.content;
        }

        if (textContent.trim()) {
          slides.push({
            slideNumber: i + 1,
            textContent: textContent.trim(),
          });
        }
      }
    } else if (rawText.trim()) {
      // Fallback: split by double newlines or large text blocks
      const paragraphs = rawText.split(/\n{2,}/).filter((p) => p.trim());

      if (paragraphs.length === 0) {
        slides.push({
          slideNumber: 1,
          textContent: rawText.trim(),
        });
      } else {
        // Group paragraphs into reasonable slide-sized chunks
        const sections = groupParagraphsIntoSections(paragraphs);
        for (let i = 0; i < sections.length; i++) {
          slides.push({
            slideNumber: i + 1,
            textContent: sections[i],
          });
        }
      }
    }

    // Try to extract title from first heading or first slide content
    if (slides.length > 0) {
      const firstContent = slides[0].textContent;
      const firstLine = firstContent.split('\n')[0].trim();
      if (firstLine.length < 100) {
        metadata.title = firstLine;
      }
    }
  } catch (e) {
    errors.push(`Error parsing document: ${e.message}`);
  }

  if (slides.length === 0 && errors.length === 0) {
    errors.push(
      'Could not extract any text from the document. It may be empty or protected.',
    );
  }

  return { slides, figures, metadata, errors };
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

    // Start new section with this heading
    currentSection = {
      heading: stripHtml(match[2]).trim(),
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
 * Strip HTML tags and decode entities.
 */
function stripHtml(html) {
  return (
    String(html || '')
      // Remove HTML tags
      .replace(/<[^>]+>/g, '\n')
      // Decode common entities — `&amp;` last, so `&amp;lt;` decodes to the
      // literal text `&lt;` instead of `<` (js/double-escaping)
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&amp;/g, '&')
      // Clean up whitespace
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/ +\n/g, '\n')
      .replace(/\n +/g, '\n')
      .trim()
  );
}

/**
 * Group paragraphs into reasonable section sizes for slides.
 * Aims for chunks that would fit on a slide (not too long, not too short).
 */
function groupParagraphsIntoSections(paragraphs) {
  const sections = [];
  let currentSection = [];
  let currentLength = 0;
  const maxLength = 1000; // Max characters before forcing a split

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // Check if this paragraph looks like a heading (short, no punctuation at end)
    const looksLikeHeading =
      trimmed.length < 80 &&
      !trimmed.match(/[.!?;,]$/) &&
      !trimmed.includes('\n');

    if (looksLikeHeading && currentSection.length > 0) {
      // Start a new section with this heading
      sections.push(currentSection.join('\n\n'));
      currentSection = [trimmed];
      currentLength = trimmed.length;
    } else if (
      currentLength + trimmed.length > maxLength &&
      currentSection.length > 0
    ) {
      // Current section is getting too long, start a new one
      sections.push(currentSection.join('\n\n'));
      currentSection = [trimmed];
      currentLength = trimmed.length;
    } else {
      // Add to current section
      currentSection.push(trimmed);
      currentLength += trimmed.length;
    }
  }

  // Don't forget the last section
  if (currentSection.length > 0) {
    sections.push(currentSection.join('\n\n'));
  }

  return sections;
}
