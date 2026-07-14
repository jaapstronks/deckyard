/**
 * File Converter
 * Converts PowerPoint and PDF files into the presentation system format.
 * Uses AI V2 (two-phase) to intelligently map content to appropriate slide types.
 */

import { parsePptx } from './pptx-parser.js';
import { parsePdf } from './pdf-parser.js';
import { parseDocx } from './docx-parser.js';
import { processImageOnlySlides } from './image-slides.js';
import { convertWithAi } from './ai-convert.js';
import {
  detectFileType,
  formatSlidesForAi,
  slideNeedsReview,
  getReviewReason,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
} from './helpers.js';
import { convertMarkdownText, convertMarkdownBundle } from '../markdown-import/index.js';

// Re-export constants
export { SUPPORTED_EXTENSIONS, SUPPORTED_MIME_TYPES };

/**
 * Convert an uploaded file to a deck.
 * @param {Buffer} buffer - File contents
 * @param {object} options - Conversion options
 * @param {string} options.filename - Original filename (for type detection)
 * @param {string} options.mimeType - MIME type (optional, for type detection)
 * @param {string} options.lang - Target language ('nl' or 'en-GB')
 * @param {string} options.vendor - LLM vendor ('openai' or 'anthropic')
 * @param {boolean} options.enableLogging - Enable AI conversation logging (default: true)
 * @param {function} options.onStatusMessage - Callback for status messages during conversion
 * @param {function} options.onOutlineComplete - Callback when outline is ready (with statusMessages)
 * @returns {Promise<{deck: object|null, report: object}>}
 */
export async function convertFile(buffer, options = {}) {
  const {
    filename = '',
    mimeType = '',
    lang = 'auto', // 'auto' = detect from content, otherwise 'nl' or 'en-GB'
    vendor = null,
    enableLogging = true,
    onStatusMessage = null,
    onOutlineComplete = null,
  } = options;

  const report = {
    success: false,
    sourceFormat: null,
    slidesExtracted: 0,
    slidesConverted: 0,
    slidesWithIssues: [],
    warnings: [],
    errors: [],
    metadata: {},
    statusMessages: [],
  };

  // Detect file type
  const fileType = detectFileType(filename, mimeType);
  report.sourceFormat = fileType;

  if (!fileType) {
    report.errors.push(
      `Unsupported file type. Please upload a .pptx, .pdf, .docx, .rtf, .odt, .md, or .zip file. ` +
        `(filename: ${filename}, mimeType: ${mimeType})`
    );
    return { deck: null, report };
  }

  // Markdown files bypass AI entirely — deterministic conversion
  if (fileType === 'md') {
    const mdText = buffer.toString('utf-8');
    const mdResult = await convertMarkdownText(mdText, { lang: lang !== 'auto' ? lang : undefined });
    return {
      deck: mdResult.deck,
      report: {
        ...report,
        ...mdResult.report,
        sourceFormat: 'md',
      },
    };
  }

  // Zip bundles — markdown + images, deterministic conversion
  if (fileType === 'zip') {
    const zipResult = await convertMarkdownBundle(buffer, { lang: lang !== 'auto' ? lang : undefined });
    return {
      deck: zipResult.deck,
      report: {
        ...report,
        ...zipResult.report,
        sourceFormat: 'zip',
      },
    };
  }

  // Check if this is a document type (vs presentation/PDF)
  const isDocumentType = ['docx', 'rtf', 'odt'].includes(fileType);

  // Parse the file
  let parseResult;
  try {
    if (fileType === 'pptx') {
      parseResult = await parsePptx(buffer);
    } else if (fileType === 'pdf') {
      parseResult = await parsePdf(buffer);
    } else if (isDocumentType) {
      // Document types all use the docx parser (mammoth handles docx well,
      // and for rtf/odt we try to extract text similarly)
      parseResult = await parseDocx(buffer);
    }
  } catch (e) {
    report.errors.push(`Failed to parse file: ${e.message}`);
    return { deck: null, report };
  }

  if (!parseResult) {
    report.errors.push('File parsing returned no result.');
    return { deck: null, report };
  }

  report.warnings.push(...(parseResult.errors || []));
  report.metadata = parseResult.metadata || {};
  report.slidesExtracted = parseResult.slides?.length || 0;

  if (!parseResult.slides || parseResult.slides.length === 0) {
    report.errors.push('No slides could be extracted from the file.');
    return { deck: null, report };
  }

  // Process image-only slides: upload images and create image-slides directly
  const { imageOnlySlides, regularSlides, titleSlideCandidate } = await processImageOnlySlides(
    parseResult.slides,
    { onStatusMessage }
  );

  if (imageOnlySlides.length > 0) {
    console.log(`[File Convert] Found ${imageOnlySlides.length} image-only slide(s)`);
    if (typeof onStatusMessage === 'function') {
      onStatusMessage(`${imageOnlySlides.length} afbeelding-slide(s) direct converteren...`);
    }
  }

  if (titleSlideCandidate) {
    console.log(`[File Convert] Using first image slide as title slide`);
  }

  // Format remaining content for AI conversion
  const formattedContent = formatSlidesForAi(regularSlides, parseResult.metadata);

  // Get first slide content for title slide detection
  const firstSlideContent = parseResult.slides?.[0]?.textContent || '';

  // Calculate the starting index offset for AI slides
  // This is needed to correctly merge image-only slides (which have real source indices)
  // with AI-processed slides (which have sequential 0-based indices)
  const aiSlideIndexOffset = regularSlides.length > 0
    ? Math.min(...regularSlides.map(s => s._originalIndex ?? 0))
    : 0;

  // Use AI V2 to convert to deck format
  try {
    const deck = await convertWithAi(formattedContent, {
      lang,
      vendor,
      slideCount: regularSlides.length,
      metadata: parseResult.metadata,
      enableLogging,
      onStatusMessage,
      onOutlineComplete,
      firstSlideContent, // Pass first slide content for title detection
      imageOnlySlides, // Pass image-only slides to merge back in
      aiSlideIndexOffset, // Offset to apply to AI slide indices for correct ordering
      titleSlideCandidate, // Pre-extracted title slide from image-only first slide
    });

    // Include status messages in report
    if (deck._generationMeta?.statusMessages) {
      report.statusMessages = deck._generationMeta.statusMessages;
    }

    if (!deck || !deck.slides || deck.slides.length === 0) {
      report.errors.push('AI conversion produced no slides.');
      return { deck: null, report };
    }

    report.slidesConverted = deck.slides.length;
    report.success = true;

    // Check for significant slide count differences
    const difference = Math.abs(parseResult.slides.length - deck.slides.length);
    if (difference > parseResult.slides.length * 0.3) {
      report.warnings.push(
        `The original had ${parseResult.slides.length} slides, but ${deck.slides.length} were generated. ` +
          `Some content may have been combined or split differently.`
      );
    }

    // Check for slides that might need review
    for (let i = 0; i < deck.slides.length; i++) {
      const slide = deck.slides[i];
      if (slideNeedsReview(slide)) {
        report.slidesWithIssues.push({
          slideNumber: i + 1,
          type: slide.type,
          reason: getReviewReason(slide),
        });
      }
    }

    if (report.slidesWithIssues.length > 0) {
      report.warnings.push(
        `${report.slidesWithIssues.length} slide(s) may need manual review.`
      );
    }

    return { deck, report };
  } catch (e) {
    report.errors.push(`AI conversion failed: ${e.message}`);
    return { deck: null, report };
  }
}