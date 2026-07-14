/**
 * PDF Parser
 * Extracts text content from PDF files, attempting to identify slide boundaries.
 * Uses pdf-parse v2 API.
 */

/**
 * Extract text content from a PDF, grouped by page.
 * Each page is treated as a potential slide.
 * @param {Buffer} buffer - The PDF file contents
 * @returns {Promise<{slides: Array<{slideNumber: number, textContent: string}>, metadata: object, errors: string[]}>}
 */
export async function parsePdf(buffer) {
  const errors = [];
  const slides = [];
  let metadata = {};

  let PDFParse = null;
  try {
    const mod = await import('pdf-parse');
    PDFParse = mod.PDFParse;
    if (!PDFParse) {
      throw new Error('PDFParse class not found in pdf-parse module');
    }
  } catch (e) {
    return {
      slides: [],
      metadata: {},
      errors: [`PDF parsing library not available: ${e.message}`],
    };
  }

  let instance = null;
  try {
    // pdf-parse v2 uses a class-based API
    // Pass buffer data in constructor options
    instance = new PDFParse({
      data: new Uint8Array(buffer),
      verbosity: 0,
    });

    // Load the document
    await instance.load();

    // Get document info for metadata
    const info = await instance.getInfo();
    if (info?.info) {
      if (info.info.Title) metadata.title = info.info.Title;
      if (info.info.Author) metadata.author = info.info.Author;
      if (info.info.Subject) metadata.subject = info.info.Subject;
    }

    const numPages = info?.total || 1;

    // Get text content - v2 returns { pages: [{text, num}], text, total }
    const textResult = await instance.getText();

    if (textResult?.pages && textResult.pages.length > 0) {
      // Use per-page text from v2 API
      for (const page of textResult.pages) {
        const content = cleanPdfText(page.text || '');
        slides.push({
          slideNumber: page.num,
          textContent: content,
        });
      }
    } else if (textResult?.text) {
      // Fallback: split combined text by page markers or heuristics
      const rawText = textResult.text;

      // Check for page markers like "-- 1 of N --"
      const pageMarkerPattern = /--\s*\d+\s+of\s+\d+\s*--/g;
      const parts = rawText.split(pageMarkerPattern).filter(p => p.trim());

      if (parts.length > 1) {
        for (let i = 0; i < parts.length; i++) {
          const content = cleanPdfText(parts[i]);
          if (content.trim()) {
            slides.push({
              slideNumber: i + 1,
              textContent: content,
            });
          }
        }
      } else {
        // Use heuristics to split
        const heuristicSlides = splitByHeuristics(rawText, numPages);
        slides.push(...heuristicSlides);
      }
    }
  } catch (e) {
    errors.push(`Error parsing PDF: ${e.message}`);
  } finally {
    // Clean up the instance
    if (instance && typeof instance.destroy === 'function') {
      try {
        instance.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // If no slides were extracted, report an error
  if (slides.length === 0 && errors.length === 0) {
    errors.push('Could not extract any text from the PDF. It may be image-based or protected.');
  }

  return { slides, metadata, errors };
}

/**
 * Split text into slides using heuristics when proper page detection isn't possible.
 * This is a fallback for PDFs that don't have proper page markers.
 */
function splitByHeuristics(text, estimatedPages) {
  const slides = [];
  const cleanedText = cleanPdfText(text);

  if (!cleanedText.trim()) {
    return slides;
  }

  // Try to find natural breaks (empty lines, headers, etc.)
  const paragraphs = cleanedText.split(/\n{2,}/);

  if (paragraphs.length <= estimatedPages) {
    // Few paragraphs - each could be a slide
    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].trim()) {
        slides.push({
          slideNumber: i + 1,
          textContent: paragraphs[i].trim(),
        });
      }
    }
  } else {
    // Many paragraphs - group them
    const paragraphsPerSlide = Math.ceil(paragraphs.length / estimatedPages);
    for (let i = 0; i < estimatedPages; i++) {
      const start = i * paragraphsPerSlide;
      const end = Math.min(start + paragraphsPerSlide, paragraphs.length);
      const slideContent = paragraphs.slice(start, end).join('\n\n').trim();
      if (slideContent) {
        slides.push({
          slideNumber: i + 1,
          textContent: slideContent,
        });
      }
    }
  }

  return slides;
}

/**
 * Clean up PDF text artifacts
 */
function cleanPdfText(text) {
  return String(text || '')
    // Normalize whitespace
    .replace(/[ \t]+/g, ' ')
    // Remove excessive newlines but keep paragraph breaks
    .replace(/\n{3,}/g, '\n\n')
    // Clean up spacing around newlines
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .trim();
}