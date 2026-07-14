/**
 * AI Conversion
 * Uses AI V2 (two-phase) to convert formatted content into a deck.
 */

import { generateOutline, separateSlidesForProcessing } from '../ai/generate-outline.js';
import { refineAllSlideGroups } from '../ai/refine-slides.js';
import { validateAndFixRefinedSlides } from '../ai/validate-slides.js';
import { createSessionLogger, generateSessionId } from '../ai/logging.js';
import { cryptoUuid } from '../../../shared/slide-types/helpers.js';
import { firstSlideIsTitle } from './helpers.js';

/**
 * Use AI V2 (two-phase) to convert the formatted content into a deck
 */
export async function convertWithAi(formattedContent, options = {}) {
  const {
    lang = 'auto', // 'auto' = detect from content, otherwise 'nl' or 'en-GB'
    vendor = null,
    slideCount = 0,
    metadata = {},
    enableLogging = true,
    onStatusMessage = null,
    onOutlineComplete = null,
    firstSlideContent = null, // Content from the first source slide
    imageOnlySlides = [], // Pre-processed image-only slides to merge back in
    aiSlideIndexOffset = 0, // Offset to apply to AI slide indices for correct source ordering
    titleSlideCandidate = null, // Pre-extracted title slide from first image-only slide
  } = options;

  const sessionId = generateSessionId();
  const logger = enableLogging ? createSessionLogger(sessionId) : null;

  console.log(`[File Convert] Starting V2 conversion, session ${sessionId}`);

  // Phase 1: Generate outline from the formatted content
  // Pass the raw title from first slide (if available) so the LLM can use it
  // to determine a better title based on context vs actual presentation topic
  const outline = await generateOutline(formattedContent, {
    userName: metadata?.author || '',
    targetLang: lang,
    vendor,
    rawFirstSlideTitle: titleSlideCandidate?.title || firstSlideContent?.split('\n')[0] || '',
    onLog: logger ? (data) => logger.logPhase1(data) : null,
  });

  console.log(`[File Convert] Phase 1 complete: ${outline.slides.length} slides outlined`);

  // Get the detected language for use in Phase 2 (if lang was 'auto')
  const detectedLang = outline.metadata?.detectedLang || 'nl';
  const effectiveLang = (lang === 'nl' || lang === 'en-GB') ? lang : (detectedLang === 'en' ? 'en-GB' : 'nl');

  // Call onOutlineComplete immediately when outline is ready
  // This allows the caller to send status messages to the client early
  if (typeof onOutlineComplete === 'function') {
    onOutlineComplete(outline);
  }

  // Notify individual status messages if callback provided
  if (typeof onStatusMessage === 'function' && outline.statusMessages?.length) {
    for (const msg of outline.statusMessages) {
      onStatusMessage(msg);
    }
  }

  // Phase 2: Separate structural vs content slides (like the wizard does)
  const { structuralSlides, contentGroups } = separateSlidesForProcessing(outline.slides);
  console.log(`[File Convert] Structural: ${structuralSlides.length}, Content groups: ${contentGroups.length}`);

  // Refine content slides with presentation context
  let refinedContentSlides = [];
  if (contentGroups.length > 0) {
    refinedContentSlides = await refineAllSlideGroups(contentGroups, {
      lang: effectiveLang, // Use detected language for status messages
      vendor,
      batchSize: 6,
      presentationContext: {
        title: outline.title,
        summary: outline.summary,
      },
      onLog: logger ? (data) => logger.logPhase2Call(data) : null,
      onStatusMessage,
    });
  }

  console.log(`[File Convert] Phase 2 complete: ${refinedContentSlides.length} content slides refined`);

  // Combine structural + content slides, sorted by original index
  const allSlides = [...structuralSlides, ...refinedContentSlides]
    .sort((a, b) => a.originalIndex - b.originalIndex);

  // Validate and fix slides
  const validatedSlides = validateAndFixRefinedSlides(allSlides);

  // Assemble the deck
  const deck = {
    format: 'slidecreator.deck',
    version: 1,
    title: outline.title || metadata?.title || 'Converted Presentation',
    theme: 'default',
    settings: {
      stepParagraphs: true, // Enable step-by-step reveal by default for converted presentations
      transitions: { preset: 'fade' }, // Fade transition by default
    },
    slides: [],
  };

  // Title slide logic:
  // 1. If we have a titleSlideCandidate (first slide was image+title), use it
  // 2. Otherwise check if the first source slide already looked like a title
  // 3. If neither, add an automatic title slide
  if (titleSlideCandidate) {
    // Use the image from the first slide as the title slide background
    // Use the LLM-generated title (based on full content analysis) rather than
    // the raw PPTX title which may be contextual (event name, date, etc.)
    deck.slides.push({
      id: cryptoUuid(),
      type: 'title-slide',
      content: {
        title: outline.title || titleSlideCandidate.title,
        subheading: outline.subtitle || metadata?.author || '',
        background: titleSlideCandidate.imageUrl,
      },
      notes: '',
      _aiReasoning: `Title slide with image from source first slide. Original title: "${titleSlideCandidate.title}"`,
    });
  } else if (!firstSlideIsTitle(firstSlideContent, outline)) {
    // No title slide in source - add automatic one
    deck.slides.push({
      id: cryptoUuid(),
      type: 'title-slide',
      content: {
        title: outline.title || metadata?.title || 'Presentation',
        subheading: outline.subtitle || metadata?.author || '',
        background: 'lime',
      },
      notes: '',
      _aiReasoning: 'Automatic title slide (source file did not have a clear title slide)',
    });
  }

  // Merge AI-processed slides with pre-processed image-only slides
  // Both need to be combined in the correct original order
  const allProcessedSlides = [];

  // Add AI-processed slides with their tracked indices
  // Apply the offset to convert AI indices (0-based) to source indices
  for (const refined of validatedSlides) {
    const aiIndex = refined.originalIndex ?? 0;
    allProcessedSlides.push({
      originalIndex: aiIndex + aiSlideIndexOffset,
      slide: {
        id: cryptoUuid(),
        type: refined.type,
        content: refined.content,
        notes: '',
        _aiReasoning: refined.reasoning,
      },
    });
  }

  // Add pre-processed image-only slides
  for (const imgSlide of imageOnlySlides) {
    allProcessedSlides.push({
      originalIndex: imgSlide.originalIndex,
      slide: {
        id: cryptoUuid(),
        type: imgSlide.slideData.type,
        content: imgSlide.slideData.content,
        notes: '',
        _aiReasoning: imgSlide.slideData._aiReasoning,
      },
    });
  }

  // Sort by original index and add to deck
  allProcessedSlides
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .forEach(({ slide }) => deck.slides.push(slide));

  // Determine if we added a title slide (for metadata)
  const addedTitleSlide = titleSlideCandidate
    ? true // Used image+title from first slide
    : !firstSlideIsTitle(firstSlideContent, outline); // Added automatic title

  // Normalize to deck language format: 'nl' or 'en-GB'
  const deckLang = effectiveLang === 'en-GB' ? 'en-GB' : 'nl';

  // Add generation metadata
  deck._generationMeta = {
    sessionId,
    version: 'v2',
    source: 'file-convert',
    originalSlideCount: slideCount + imageOnlySlides.length,
    structuralSlides: structuralSlides.length,
    contentGroups: contentGroups.length,
    imageOnlySlides: imageOnlySlides.length,
    addedTitleSlide,
    usedTitleSlideCandidate: !!titleSlideCandidate,
    statusMessages: outline.statusMessages || [],
    detectedLang, // The language detected from the content
    effectiveLang: deckLang, // The language used for the deck (nl or en-GB)
  };

  // Store the deck language for the client
  deck.lang = deckLang;

  // Finalize logging
  if (logger) {
    logger.finalize(deck, {
      source: 'file-convert',
      originalSlideCount: slideCount,
    });
  }

  console.log(`[File Convert] Session ${sessionId} complete, ${deck.slides.length} slides`);

  return deck;
}