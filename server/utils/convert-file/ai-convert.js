/**
 * AI conversion of a parsed file: the one generation pipeline, assembled
 * around what the file brings of its own.
 *
 * `generateSlides()` runs the model phases (B756); this module only decides
 * what a file adds (B757): the first slide's image as the title background,
 * no automatic title slide when the source opens with one, and the
 * image-only slides that bypassed the model put back at their source
 * position.
 */

import { generateSlides, assembleDeck } from '../ai/generate-deck.js';
import { createSessionLogger, generateSessionId } from '../ai/logging.js';
import { firstSlideIsTitle } from './helpers.js';
import { createLogger } from '../logger.js';

const log = createLogger('convert-file');

/**
 * Convert the formatted content of a file into a deck.
 *
 * @param {string} formattedContent - The regular slides, formatted for the model.
 * @param {object} options
 * @param {string} [options.lang] - `auto` (detect from the content) or a deck language.
 * @param {string|null} [options.vendor]
 * @param {number} [options.slideCount] - Regular slides the model was given.
 * @param {object} [options.metadata] - The file's metadata (`title`, `author`).
 * @param {Function} [options.onStatusMessage]
 * @param {Function} [options.onOutlineComplete] - `(outline, { sections, lang })`
 *   once the outline is ready.
 * @param {Function} [options.onGroupDone] - `({ done, total })` per finished group.
 * @param {string|null} [options.firstSlideContent] - The first source slide's
 *   text, for the title-slide decision.
 * @param {Array} [options.imageOnlySlides] - Slides converted without the
 *   model, with their source index (`processImageOnlySlides`).
 * @param {number} [options.aiSlideIndexOffset] - Source index of the first
 *   regular slide, so model indices (0-based) merge with the image slides.
 * @param {{ title: string, imageUrl: string }|null} [options.titleSlideCandidate]
 *   - The first slide's image, when it had one.
 * @param {AbortSignal|null} [options.signal]
 * @param {Record<string, Object>} options.slideTypes - The organization's merged type map (B247).
 * @param {string[]} [options.disabledSlideTypes] - Kept out of the offered catalog (B659).
 * @param {Object[]} [options.customSlideTypes] - The org's published types, offered too (B659).
 * @param {Object|null} [options.themeContext] - From `loadAiThemeContext()`.
 * @param {string} [options.titleSlideType] - The theme's title slide type.
 * @returns {Promise<Object>} Deck JSON with `lang` and `_generationMeta`.
 */
export async function convertWithAi(formattedContent, options = {}) {
  const {
    lang = 'auto',
    vendor = null,
    slideCount = 0,
    metadata = {},
    onStatusMessage = null,
    onOutlineComplete = null,
    onGroupDone = null,
    firstSlideContent = null,
    imageOnlySlides = [],
    aiSlideIndexOffset = 0,
    titleSlideCandidate = null,
    signal = null,
    slideTypes,
    disabledSlideTypes = [],
    customSlideTypes = [],
    themeContext = null,
    titleSlideType = 'title-slide',
  } = options;

  const logger = createSessionLogger(generateSessionId());
  log.info(`Starting conversion, session ${logger.sessionId}`);

  // The file's own first title goes along as context, so the model can tell
  // a contextual first line (event name, date) from the presentation's topic.
  const {
    outline,
    slides,
    lang: deckLang,
    meta,
  } = await generateSlides(formattedContent, {
    userName: metadata?.author || '',
    targetLang: lang,
    vendor,
    rawFirstSlideTitle:
      titleSlideCandidate?.title || firstSlideContent?.split('\n')[0] || '',
    slideTypes,
    disabledSlideTypes,
    customSlideTypes,
    themeContext,
    signal,
    onOutline: onOutlineComplete,
    onStatusMessage,
    onGroupDone,
    logger,
  });

  // Title slide: the first slide's image becomes its background; a source
  // that already opens with a title slide gets no automatic one.
  const subheading = outline.subtitle || metadata?.author || '';
  let titleSlide;
  if (titleSlideCandidate) {
    titleSlide = {
      title: outline.title || titleSlideCandidate.title,
      subheading,
      background: titleSlideCandidate.imageUrl,
    };
  } else if (firstSlideIsTitle(firstSlideContent, outline)) {
    titleSlide = null;
  } else {
    titleSlide = {
      title: outline.title || metadata?.title || 'Presentation',
      subheading,
    };
  }

  // The model's slides and the image-only slides share one source order:
  // model indices are 0-based over the regular slides, the image slides keep
  // their source index.
  const inSourceOrder = [
    ...slides.map((refined) => ({
      ...refined,
      originalIndex: (refined.originalIndex ?? 0) + aiSlideIndexOffset,
    })),
    ...imageOnlySlides.map((imgSlide) => ({
      type: imgSlide.slideData.type,
      content: imgSlide.slideData.content,
      reasoning: imgSlide.slideData._aiReasoning,
      originalIndex: imgSlide.originalIndex,
    })),
  ].sort((a, b) => a.originalIndex - b.originalIndex);

  const deck = assembleDeck(outline, inSourceOrder, {
    titleSlideType,
    lang: deckLang,
    titleSlide,
  });
  deck.title = outline.title || metadata?.title || 'Converted Presentation';
  // Step-by-step reveal and a fade by default for a converted presentation.
  deck.settings = {
    stepParagraphs: true,
    transitions: { preset: 'fade' },
  };
  if (titleSlideCandidate) {
    deck.slides[0]._aiReasoning = `Title slide with image from source first slide. Original title: "${titleSlideCandidate.title}"`;
  } else if (titleSlide) {
    deck.slides[0]._aiReasoning =
      'Automatic title slide (source file did not have a clear title slide)';
  }

  deck._generationMeta = {
    ...meta,
    source: 'file-convert',
    originalSlideCount: slideCount + imageOnlySlides.length,
    imageOnlySlides: imageOnlySlides.length,
    addedTitleSlide: titleSlide !== null,
    usedTitleSlideCandidate: !!titleSlideCandidate,
  };

  logger.finalize(deck, {
    source: 'file-convert',
    originalSlideCount: slideCount,
  });
  log.info(
    `Session ${logger.sessionId} complete, ${deck.slides.length} slides`,
  );

  return deck;
}
