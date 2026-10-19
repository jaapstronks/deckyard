/**
 * Notion Page Converter
 * Converts Notion pages into the presentation system format.
 * Runs the one generation pipeline (`generateSlides()`, B757). The page's
 * images go along as candidates the model places where they fit (B775);
 * only the ones it places are re-hosted.
 */

import {
  extractPageId,
  extractRichContentFromPage,
  formatNotionContentForAi,
  notionEnabled,
  NOTION_NOT_CONFIGURED_MESSAGE,
} from './notion/index.js';
import { generateSlides, assembleDeck } from './ai/generate-deck.js';
import { createSessionLogger, generateSessionId } from './ai/logging.js';
import { uploadOnce } from './ai/source-images.js';
import { cryptoUuid } from '../../shared/slide-types/helpers.js';
import {
  uploadImageKitUrl,
  getImageKitConfigFromEnv,
} from '../media/imagekit.js';
import { isMediaProviderInitialized } from '../media/index.js';
import { rehostRemoteImage } from '../media/rehost.js';
import { createLogger } from './logger.js';

const log = createLogger('convert-notion');

/**
 * Convert a Notion page to a deck.
 * @param {string} urlOrPageId - Notion page URL or ID
 * @param {object} options - Conversion options
 * @param {string} options.lang - Target language ('nl' or 'en-GB' or 'auto')
 * @param {string} options.vendor - LLM vendor ('openai' or 'anthropic')
 * @param {function} options.onStatusMessage - Callback for status messages during conversion
 * @param {function} options.onOutline - `(outline, { sections, lang })` once
 *   the outline is ready (the `generateSlides()` hook)
 * @param {function} options.onGroupDone - ({ done, total }) => void, called as
 *   each section group finishes (real progress, for streaming UIs)
 * @param {AbortSignal} [options.signal] - Cancels the import: it reaches both
 *   model phases and is checked before every image re-host, so a caller whose
 *   reader left stops instead of importing for nobody.
 * @param {Record<string, Object>} options.slideTypes - The organization's
 *   merged type map; the AI slides are fixed against it (B247).
 * @param {string[]} [options.disabledSlideTypes] - Types the organization
 *   may not insert; kept out of the catalog the model chooses from (B659).
 * @param {Array} [options.customSlideTypes] - The organization's published
 *   custom types, offered next to the core catalog (B659).
 * @param {Object|null} [options.themeContext] - The theme context the model
 *   sees in phase 2 (`loadAiThemeContext()`).
 * @param {string} [options.titleSlideType] - The theme's title slide type.
 * @returns {Promise<{deck: object|null, report: object, pageId: string}>}
 */
export async function convertNotionPage(urlOrPageId, options = {}) {
  const {
    lang = 'auto',
    vendor = null,
    onStatusMessage = null,
    onOutline = null,
    onGroupDone = null,
    signal = null,
    slideTypes,
    disabledSlideTypes = [],
    customSlideTypes = [],
    themeContext = null,
    titleSlideType = 'title-slide',
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
    report.errors.push(NOTION_NOT_CONFIGURED_MESSAGE);
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
    richContent = await extractRichContentFromPage(pageId, {
      depth: 3,
      limit: 600,
    });
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
  report.tablesExtracted = richContent.sections.reduce(
    (sum, s) => sum + s.tables.length,
    0,
  );
  report.metadata = {
    title: richContent.title,
    lastEdited: richContent.metadata.lastEdited,
  };

  // The page's images, re-hosted only when a slide (or the title) uses one
  const sourceImages = richContent.allImages.map((img) => ({
    n: img.n,
    caption: img.caption || '',
    upload: uploadOnce(async () => {
      const [hosted] = await processNotionImages([img], { signal });
      return hosted?.uploadedUrl || '';
    }),
  }));

  // Format content for AI
  const formattedContent = formatNotionContentForAi(richContent);

  // The one generation pipeline, assembled around the page's images
  try {
    const deck = await convertWithAi(formattedContent, {
      lang,
      vendor,
      sectionCount: richContent.sections.length,
      metadata: report.metadata,
      onStatusMessage,
      onOutline,
      onGroupDone,
      sourceImages,
      signal,
      slideTypes,
      disabledSlideTypes,
      customSlideTypes,
      themeContext,
      titleSlideType,
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
    // A cancelled conversion is not a failed one: it propagates so the caller
    // can tell "the client left" from "this file could not be converted".
    if (signal?.aborted) throw e;
    report.errors.push(`AI conversion failed: ${e.message}`);
    return { deck: null, report, pageId };
  }
}

/**
 * Re-host a single Notion image through Deckyard's own media library.
 *
 * Notion's file-hosted image URLs are signed and expire (~1h), so keeping them
 * verbatim leaves an imported deck broken shortly after import. When ImageKit is
 * not configured this fetches the bytes and stores them via the configured media
 * provider (local `/uploads` or S3), yielding a durable URL. An unavailable
 * provider returns no URL; a failed copy throws to the caller.
 * @param {{ url: string }} img
 * @returns {Promise<string>} A durable media-library URL, or an empty string.
 */
async function rehostImageToMediaLibrary(img) {
  if (!isMediaProviderInitialized()) {
    return '';
  }

  const { publicUrl } = await rehostRemoteImage({
    url: img.url,
    filename: `notion-${img.blockId || cryptoUuid()}`,
  });

  return publicUrl || '';
}

/**
 * Process Notion images, re-hosting them so an imported deck stays durable.
 *
 * When ImageKit is configured images are re-hosted there (unchanged). Otherwise
 * they are re-hosted through Deckyard's own media library, because Notion's
 * signed URLs expire (~1h) and would leave the deck broken. A failed copy
 * returns no URL; the source-image resolver clears the field and warns.
 * @param {Array} images - Array of { url, caption, blockId }
 * @param {object} options - Options
 * @param {AbortSignal} [options.signal] - Checked before every re-host, so a
 *   cancelled import stops filling the media library.
 * @returns {Promise<Array<{originalUrl: string, uploadedUrl: string, caption: string}>>}
 */
export async function processNotionImages(images, options = {}) {
  const { signal = null } = options;
  const results = [];

  // Check if ImageKit is configured
  const imagekitConfig = getImageKitConfigFromEnv();
  if (!imagekitConfig.configured) {
    log.info('ImageKit not configured, re-hosting via the media library');
    // Fallback: re-host each image through the own media library so imported
    // decks survive Notion's ~1h signed-URL expiry.
    for (const img of images) {
      signal?.throwIfAborted();
      try {
        const uploadedUrl = await rehostImageToMediaLibrary(img);
        signal?.throwIfAborted();
        results.push({
          originalUrl: img.url,
          uploadedUrl,
          caption: img.caption || '',
          blockId: img.blockId,
        });
      } catch (e) {
        if (signal?.aborted) throw e;
        log.error(`Failed to re-host image via media library: ${e.message}`);
        results.push({
          originalUrl: img.url,
          uploadedUrl: '',
          caption: img.caption || '',
          blockId: img.blockId,
        });
      }
    }
    return results;
  }

  for (let i = 0; i < images.length; i++) {
    signal?.throwIfAborted();
    const img = images[i];
    try {
      // Upload image from URL to ImageKit
      const filename = `notion-${img.blockId || cryptoUuid()}.jpg`;
      const uploadedUrl = await uploadImageKitUrl(img.url, filename);
      signal?.throwIfAborted();

      results.push({
        originalUrl: img.url,
        uploadedUrl: uploadedUrl || '',
        caption: img.caption || '',
        blockId: img.blockId,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      log.error(`Failed to upload image: ${e.message}`);
      results.push({
        originalUrl: img.url,
        uploadedUrl: '',
        caption: img.caption || '',
        blockId: img.blockId,
      });
    }
  }

  return results;
}

/**
 * Convert formatted Notion content to a deck: the one generation pipeline
 * (`generateSlides()`, B756). The images are candidates the model places
 * (B775); the first one does not become a cover without a model choice.
 */
async function convertWithAi(formattedContent, options = {}) {
  const {
    lang = 'auto',
    vendor = null,
    sectionCount = 0,
    metadata = {},
    onStatusMessage = null,
    onOutline = null,
    onGroupDone = null,
    sourceImages = [],
    signal = null,
    slideTypes,
    disabledSlideTypes = [],
    customSlideTypes = [],
    themeContext = null,
    titleSlideType = 'title-slide',
  } = options;

  const logger = createSessionLogger(generateSessionId());
  log.info(`Starting AI conversion session ${logger.sessionId}`);
  log.info(
    `Content length: ${formattedContent.length} chars, ${sectionCount} sections`,
  );

  if (typeof onStatusMessage === 'function') {
    onStatusMessage('Analyzing content structure...');
  }

  const {
    outline,
    slides,
    lang: deckLang,
    meta,
  } = await generateSlides(formattedContent, {
    userName: metadata?.author || '',
    targetLang: lang,
    vendor,
    slideTypes,
    disabledSlideTypes,
    customSlideTypes,
    themeContext,
    sourceImages,
    signal,
    onOutline,
    onStatusMessage,
    onGroupDone,
    logger,
  });

  const title = outline.title || metadata.title || 'Untitled';

  const deck = assembleDeck(outline, slides, {
    titleSlideType,
    lang: deckLang,
    titleSlide: { title },
  });
  deck.title = title;
  deck.settings = {
    stepParagraphs: true,
    transitions: { preset: 'fade' },
  };

  deck._generationMeta = {
    ...meta,
    source: 'notion',
    outlineSlideCount: outline.slides.length,
    finalSlideCount: deck.slides.length,
  };

  logger.finalize(deck, { source: 'notion' });

  return deck;
}
