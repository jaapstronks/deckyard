/**
 * Document Parser
 * Extracts text content from Word documents (.docx) and similar formats.
 * Uses mammoth for reliable text extraction.
 */

import mammoth from 'mammoth';

/**
 * Extract text content from a Word document, attempting to identify sections.
 * Each major section (based on headings) is treated as a potential slide.
 * @param {Buffer} buffer - The document file contents
 * @returns {Promise<{slides: Array<{slideNumber: number, textContent: string}>, metadata: object, errors: string[]}>}
 */
export async function parseDocx(buffer) {
  const errors = [];
  const slides = [];
  const metadata = {};

  try {
    // Extract text with style information to detect headings
    const result = await mammoth.convertToHtml({ buffer });

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

    // Parse HTML to extract structure
    const sections = parseHtmlToSections(result.value || '');

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
      const paragraphs = rawText.split(/\n{2,}/).filter(p => p.trim());

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
    errors.push('Could not extract any text from the document. It may be empty or protected.');
  }

  return { slides, metadata, errors };
}

/**
 * Parse HTML output from mammoth to extract sections based on headings.
 */
function parseHtmlToSections(html) {
  const sections = [];
  let currentSection = { heading: '', content: '' };

  // Simple HTML parsing - extract headings and content
  // Split by heading tags
  const headingPattern = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  const parts = html.split(headingPattern);

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
  return String(html || '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '\n')
    // Decode common entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .trim();
}

/**
 * Group paragraphs into reasonable section sizes for slides.
 * Aims for chunks that would fit on a slide (not too long, not too short).
 */
function groupParagraphsIntoSections(paragraphs) {
  const sections = [];
  let currentSection = [];
  let currentLength = 0;
  const targetLength = 500; // Target characters per section
  const maxLength = 1000; // Max characters before forcing a split

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // Check if this paragraph looks like a heading (short, no punctuation at end)
    const looksLikeHeading = trimmed.length < 80 &&
      !trimmed.match(/[.!?;,]$/) &&
      !trimmed.includes('\n');

    if (looksLikeHeading && currentSection.length > 0) {
      // Start a new section with this heading
      sections.push(currentSection.join('\n\n'));
      currentSection = [trimmed];
      currentLength = trimmed.length;
    } else if (currentLength + trimmed.length > maxLength && currentSection.length > 0) {
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