/**
 * Notion Page Converter
 * Converts Notion pages into the presentation system format.
 * Uses AI V2 (two-phase) to intelligently map content to appropriate slide types.
 * Handles images and tables from Notion pages.
 */

import {
  extractPageId,
  extractRichContentFromPage,
  formatNotionContentForAi,
  notionEnabled,
} from './notion.js';
import { generateOutline, separateSlidesForProcessing } from './ai/generate-outline.js';
import { refineAllSlideGroups } from './ai/refine-slides.js';
import { validateAndFixRefinedSlides } from './ai/validate-slides.js';
import { createSessionLogger, generateSessionId } from './ai/logging.js';
import { cryptoUuid } from '../../shared/slide-types/helpers.js';
import { uploadImageKitUrl, getImageKitConfigFromEnv } from '../media/imagekit.js';

/**
 * Convert a Notion page to a deck.
 * @param {string} urlOrPageId - Notion page URL or ID
 * @param {object} options - Conversion options
 * @param {string} options.lang - Target language ('nl' or 'en-GB' or 'auto')
 * @param {string} options.vendor - LLM vendor ('openai' or 'anthropic')
 * @param {boolean} options.enableLogging - Enable AI conversation logging (default: true)
 * @param {function} options.onStatusMessage - Callback for status messages during conversion
 * @param {function} options.onOutlineComplete - Callback when outline is ready (with statusMessages)
 * @returns {Promise<{deck: object|null, report: object, pageId: string}>}
 */
export async function convertNotionPage(urlOrPageId, options = {}) {
  const {
    lang = 'auto',
    vendor = null,
    enableLogging = true,
    onStatusMessage = null,
    onOutlineComplete = null,
  } = options;

  const report = {
    success: false,
    sourceFormat: 'notion',
    sectionsExtracted: 0,
    imagesExtracted: 0,
    tablesExtracted: 0,
    slidesConverted: 0,
    slidesWithIssues: [],
    warnings: [],
    errors: [],
    metadata: {},
    statusMessages: [],
  };

  // Check if Notion is configured
  if (!notionEnabled()) {
    report.errors.push('Notion is not configured. Set NOTION_SECRET environment variable.');
    return { deck: null, report, pageId: null };
  }

  // Extract page ID
  const pageId = extractPageId(urlOrPageId);
  if (!pageId) {
    report.errors.push('Invalid Notion page URL or ID.');
    return { deck: null, report, pageId: null };
  }

  // Extract rich content from the Notion page
  let richContent;
  try {
    if (typeof onStatusMessage === 'function') {
      onStatusMessage('Fetching Notion page content...');
    }
    richContent = await extractRichContentFromPage(pageId, { depth: 3, limit: 600 });
  } catch (e) {
    report.errors.push(`Failed to fetch Notion page: ${e.message}`);
    return { deck: null, report, pageId };
  }

  if (!richContent || richContent.sections.length === 0) {
    report.errors.push('No content could be extracted from the Notion page.');
    return { deck: null, report, pageId };
  }

  report.sectionsExtracted = richContent.sections.length;
  report.imagesExtracted = richContent.allImages.length;
  report.tablesExtracted = richContent.sections.reduce((sum, s) => sum + s.tables.length, 0);
  report.metadata = {
    title: richContent.title,
    lastEdited: richContent.metadata.lastEdited,
  };

  // Process images - upload to ImageKit
  const processedImages = [];
  if (richContent.allImages.length > 0) {
    if (typeof onStatusMessage === 'function') {
      onStatusMessage(`Processing ${richContent.allImages.length} image(s)...`);
    }
    const uploadedImages = await processNotionImages(richContent.allImages, { onStatusMessage });
    processedImages.push(...uploadedImages);
  }

  // Format content for AI
  const formattedContent = formatNotionContentForAi(richContent);

  // Use AI V2 to convert to deck format
  try {
    const deck = await convertWithAi(formattedContent, {
      lang,
      vendor,
      sectionCount: richContent.sections.length,
      metadata: report.metadata,
      enableLogging,
      onStatusMessage,
      onOutlineComplete,
      processedImages,
      richContent, // Pass full content for image/table slide creation
    });

    // Include status messages in report
    if (deck._generationMeta?.statusMessages) {
      report.statusMessages = deck._generationMeta.statusMessages;
    }

    if (!deck || !deck.slides || deck.slides.length === 0) {
      report.errors.push('AI conversion produced no slides.');
      return { deck: null, report, pageId };
    }

    report.slidesConverted = deck.slides.length;
    report.success = true;

    return { deck, report, pageId };
  } catch (e) {
    report.errors.push(`AI conversion failed: ${e.message}`);
    return { deck: null, report, pageId };
  }
}

/**
 * Process Notion images by uploading them to ImageKit.
 * @param {Array} images - Array of { url, caption, blockId }
 * @param {object} options - Options
 * @returns {Promise<Array<{originalUrl: string, uploadedUrl: string, caption: string}>>}
 */
async function processNotionImages(images, options = {}) {
  const results = [];

  // Check if ImageKit is configured
  const imagekitConfig = getImageKitConfigFromEnv();
  if (!imagekitConfig.configured) {
    console.log('[Notion Convert] ImageKit not configured, using original URLs');
    // Return original URLs if ImageKit is not configured
    return images.map((img) => ({
      originalUrl: img.url,
      uploadedUrl: img.url, // Use original URL
      caption: img.caption || '',
      blockId: img.blockId,
    }));
  }

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      // Upload image from URL to ImageKit
      const filename = `notion-${img.blockId || cryptoUuid()}.jpg`;
      const uploadedUrl = await uploadImageKitUrl(img.url, filename);

      results.push({
        originalUrl: img.url,
        uploadedUrl: uploadedUrl || img.url,
        caption: img.caption || '',
        blockId: img.blockId,
      });
    } catch (e) {
      console.error(`[Notion Convert] Failed to upload image: ${e.message}`);
      // Fall back to original URL
      results.push({
        originalUrl: img.url,
        uploadedUrl: img.url,
        caption: img.caption || '',
        blockId: img.blockId,
      });
    }
  }

  return results;
}

/**
 * Convert formatted content to a deck using AI V2.
 */
async function convertWithAi(formattedContent, options = {}) {
  const {
    lang = 'auto',
    vendor = null,
    sectionCount = 0,
    metadata = {},
    enableLogging = true,
    onStatusMessage = null,
    onOutlineComplete = null,
    processedImages = [],
    richContent = null,
  } = options;

  const sessionId = generateSessionId();
  const logger = enableLogging ? createSessionLogger(sessionId) : null;

  console.log(`[Notion Convert] Starting AI conversion session ${sessionId}`);
  console.log(`[Notion Convert] Content length: ${formattedContent.length} chars, ${sectionCount} sections`);

  // Phase 1: Generate outline
  if (typeof onStatusMessage === 'function') {
    onStatusMessage('Analyzing content structure...');
  }

  const outline = await generateOutline(formattedContent, {
    userName: metadata?.author || '',
    targetLang: lang === 'auto' ? null : lang,
    vendor,
    onLog: logger ? (data) => logger.logPhase1(data) : null,
  });

  // Determine effective language
  const effectiveLang =
    lang !== 'auto'
      ? lang
      : outline.metadata?.detectedLang ||
        outline.metadata?.requestedLang ||
        'nl';

  console.log(`[Notion Convert] Outline generated: ${outline.slides.length} slides planned, lang=${effectiveLang}`);

  // Notify about status messages
  const statusMessages = outline.statusMessages || [];
  if (typeof onOutlineComplete === 'function') {
    onOutlineComplete({ statusMessages, slideCount: outline.slides.length });
  }

  // Separate structural vs content slides
  const { structuralSlides, contentGroups } = separateSlidesForProcessing(outline.slides);

  console.log(`[Notion Convert] Separated: ${structuralSlides.length} structural, ${contentGroups.length} content groups`);

  // Phase 2: Refine content slides
  if (typeof onStatusMessage === 'function') {
    onStatusMessage('Creating slides...');
  }

  let refinedContentSlides = [];
  if (contentGroups.length > 0) {
    refinedContentSlides = await refineAllSlideGroups(contentGroups, {
      lang: effectiveLang,
      vendor,
      presentationContext: {
        title: outline.title,
        summary: outline.summary,
      },
      onLog: logger ? (data) => logger.logPhase2(data) : null,
    });
  }

  // Validate refined slides
  const validatedSlides = validateAndFixRefinedSlides(refinedContentSlides, {
    allowPartial: true,
  });

  // Merge structural and content slides, sorted by originalIndex
  const allSlides = [
    ...structuralSlides.map((s, i) => ({
      ...s,
      originalIndex: s.originalIndex ?? i,
    })),
    ...validatedSlides.map((s, i) => ({
      ...s,
      originalIndex: s.originalIndex ?? (structuralSlides.length + i),
    })),
  ].sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));

  // Build the title slide
  const titleSlide = {
    type: 'title-slide',
    content: {
      title: outline.title || metadata.title || 'Untitled',
      subheading: outline.subtitle || '',
      background: 'lime',
    },
  };

  // Check if we have an image for the title slide
  if (processedImages.length > 0 && richContent?.sections?.[0]?.images?.length > 0) {
    // Use the first image as title background if available
    const firstImg = processedImages[0];
    if (firstImg?.uploadedUrl) {
      titleSlide.content.backgroundImage = firstImg.uploadedUrl;
      titleSlide.content.background = 'image';
    }
  }

  // Assemble the deck
  const deck = {
    format: 'slidecreator.deck',
    version: 1,
    title: outline.title || metadata.title || 'Untitled',
    theme: 'default',
    lang: effectiveLang,
    slides: [
      titleSlide,
      ...allSlides.map((slide) => ({
        type: slide.type,
        content: slide.content,
        notes: '',
        _aiReasoning: slide.reasoning || '',
      })),
    ],
    settings: {
      stepParagraphs: true,
      transitions: { preset: 'fade' },
    },
    _generationMeta: {
      source: 'notion',
      sessionId,
      effectiveLang,
      statusMessages,
      outlineSlideCount: outline.slides.length,
      finalSlideCount: allSlides.length + 1,
    },
  };

  // Insert image slides for remaining images (beyond the first one used for title)
  if (processedImages.length > 1 && richContent) {
    insertImageSlides(deck, processedImages.slice(1), richContent);
  }

  // Finalize logging
  if (logger) {
    logger.finalize(deck, {
      sessionId,
      totalSlides: deck.slides.length,
      source: 'notion',
    });
  }

  return deck;
}

/**
 * Insert image slides into the deck at appropriate positions.
 * This is a simple approach - adds image slides after the content they relate to.
 */
function insertImageSlides(deck, images, richContent) {
  // For now, append image slides at the end before any closing slide
  // A more sophisticated approach would try to match images to sections

  const lastSlide = deck.slides[deck.slides.length - 1];
  const hasClosingSlide =
    lastSlide?.type === 'payoff-slide' || lastSlide?.type === 'closing-slide';

  const insertIndex = hasClosingSlide
    ? deck.slides.length - 1
    : deck.slides.length;

  for (const img of images) {
    if (!img.uploadedUrl) continue;

    const imageSlide = {
      type: 'image-slide',
      content: {
        title: img.caption || '',
        subheading: '',
        image: img.uploadedUrl,
        alt: img.caption || '',
        imageRole: 'content',
        caption: '',
        layout: 'full',
        zoomSteps: '',
        zoomLevel: 2,
      },
      notes: '',
      _aiReasoning: 'Image extracted from Notion page',
    };

    deck.slides.splice(insertIndex, 0, imageSlide);
  }
}