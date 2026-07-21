/**
 * Phase 1: Outline Generation
 *
 * Creates a presentation outline from raw content WITHOUT knowing about specific slide types.
 * This phase focuses on:
 * - Structuring content into logical slides
 * - Identifying chapters
 * - Providing grouping hints for Phase 2
 * - Detecting quotes, timelines, and other patterns
 */

import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent, LlmError } from '../llm/index.js';
import { extractJsonObject } from '../openai/json.js';
import { detectDeckLanguage, normalizeLang } from '../openai/lang.js';
import { prompts } from './prompts/index.js';

/**
 * Calculate target slide count based on content length and user preference
 *
 * @param {string} rawContent - The source content
 * @param {string} targetLength - 'auto', '5min', '10min', '20min', '30min'
 * @returns {{ targetSlides: number, estimatedInputLines: number }}
 */
export function calculateTargetSlides(rawContent, targetLength) {
  const lines = rawContent.split('\n').filter(l => l.trim()).length;
  const words = rawContent.split(/\s+/).filter(w => w.trim()).length;

  // Pre-defined targets for user selections
  const presets = {
    '5min': 6,
    '10min': 12,
    '20min': 20,
    '30min': 30,
  };

  if (targetLength && presets[targetLength]) {
    return { targetSlides: presets[targetLength], estimatedInputLines: lines };
  }

  // Auto mode: ~1 slide per 50-100 words, with min 5 and max 25
  // More aggressive compression: 1 slide per 75 words
  const computed = Math.max(5, Math.min(25, Math.round(words / 75)));
  return { targetSlides: computed, estimatedInputLines: lines };
}

/**
 * Validate and normalize Phase 1 output
 */
function normalizePhase1Output(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Phase 1 did not return valid JSON');
  }

  const output = {
    title: String(parsed.title || 'Untitled Presentation').trim(),
    subtitle: String(parsed.subtitle || '').trim(),
    summary: String(parsed.summary || '').trim(),
    statusMessages: [],
    chapters: [],
    slides: [],
  };

  // Normalize status messages
  if (Array.isArray(parsed.statusMessages)) {
    output.statusMessages = parsed.statusMessages
      .map(msg => String(msg || '').trim())
      .filter(msg => msg.length > 0);
  }

  // Add fallback messages if none were generated
  // Note: statusMessages in output will be in the requested language (LLM should generate them)
  // These fallbacks are Dutch as that's the default language
  if (output.statusMessages.length === 0) {
    output.statusMessages = [
      'Presentatie voorbereiden...',
      'Inhoud analyseren...',
      'Hoofdpunten structureren...',
      'Slides maken...',
      'Layouts selecteren...',
      'Afwerking toevoegen...',
    ];
  }

  // Ensure minimum number of messages
  const minMessages = 6;
  if (output.statusMessages.length < minMessages) {
    const genericMessages = [
      'Inhoud verwerken...',
      'Structuur bepalen...',
      'Slides opmaken...',
      'Details toevoegen...',
    ];
    while (output.statusMessages.length < minMessages && genericMessages.length > 0) {
      output.statusMessages.push(genericMessages.shift());
    }
  }

  // Normalize chapters (for metadata only - not used in grouping)
  if (Array.isArray(parsed.chapters)) {
    output.chapters = parsed.chapters.map((ch, idx) => ({
      title: String(ch?.title || `Chapter ${idx + 1}`).trim(),
      slideIndexes: Array.isArray(ch?.slideIndexes) ? ch.slideIndexes : [],
    }));
  }

  // Normalize slides - filter out any "opening" intent (handled separately)
  if (Array.isArray(parsed.slides)) {
    let slideIndex = 0;
    for (const slide of parsed.slides) {
      const intent = normalizeIntent(slide?.intent);
      // Skip opening slides - title is handled at top level
      if (intent === 'opening') continue;

      output.slides.push({
        index: slideIndex++,
        intent,
        roughContent: String(slide?.roughContent || '').trim(),
        presenterNotes: String(slide?.presenterNotes || '').trim(),
        hints: Array.isArray(slide?.hints) ? slide.hints.map(h => String(h).trim()) : [],
        groupId: slide?.groupId != null ? String(slide.groupId).trim() : null,
      });
    }
  }

  // Ensure we have at least one slide
  if (output.slides.length === 0) {
    output.slides.push({
      index: 0,
      intent: 'content',
      roughContent: 'Overview',
      presenterNotes: '',
      hints: [],
      groupId: null,
    });
  }

  return output;
}

/**
 * Normalize intent value
 */
function normalizeIntent(intent) {
  const valid = ['opening', 'chapter', 'content', 'quote', 'closing'];
  const normalized = String(intent || 'content').toLowerCase().trim();
  return valid.includes(normalized) ? normalized : 'content';
}

/**
 * Convert a structural slide (chapter/quote/closing) to its final form
 * These don't need AI refinement - they're simple enough to resolve directly.
 */
function resolveStructuralSlide(slide) {
  const { intent, roughContent, index, presenterNotes } = slide;

  if (intent === 'chapter') {
    const lines = roughContent.split('\n').map(l => l.trim()).filter(Boolean);
    return {
      originalIndex: index,
      type: 'chapter-title-slide',
      content: {
        title: lines[0] || 'Chapter',
        subtitle: lines[1] || '',
      },
      reasoning: 'Structural: chapter divider resolved directly',
      presenterNotes: presenterNotes || '',
    };
  }

  if (intent === 'quote') {
    const lines = roughContent.split('\n').map(l => l.trim()).filter(Boolean);
    // Try to extract quote, author name, and title
    let quote = lines[0] || '';
    let authorName = lines[1] || '';
    let authorTitle = lines[2] || '';

    // If quote is too long, truncate
    if (quote.length > 260) {
      quote = quote.slice(0, 257) + '...';
    }

    return {
      originalIndex: index,
      type: 'quote-slide',
      content: {
        quote,
        authorName: authorName || 'Unknown',
        authorTitle: authorTitle || '',
      },
      reasoning: 'Structural: quote resolved directly',
      presenterNotes: presenterNotes || '',
    };
  }

  if (intent === 'closing') {
    return {
      originalIndex: index,
      type: 'payoff-slide',
      content: {
        tagline: roughContent.slice(0, 120) || '',
      },
      reasoning: 'Structural: closing slide resolved directly',
      presenterNotes: presenterNotes || '',
    };
  }

  // Fallback for any unexpected intent
  return null;
}

/**
 * Generate a presentation outline from raw content
 *
 * @param {string} rawContent - The source text to create a presentation from
 * @param {Object} options
 * @param {string} options.userName - Speaker/presenter name for title slide
 * @param {string} options.targetLang - 'nl' or 'en-GB' (optional, auto-detected if not provided)
 * @param {string} options.vendor - LLM vendor override
 * @param {string} options.targetLength - Target length: 'auto', '5min', '10min', '20min', '30min'
 * @param {string} options.rawFirstSlideTitle - Original title from source file's first slide (for context)
 * @param {Function} options.onLog - Callback to log the conversation
 * @returns {Promise<Object>} The presentation outline
 */
export async function generateOutline(rawContent, {
  userName = '',
  targetLang = null,
  vendor = null,
  targetLength = 'auto',
  rawFirstSlideTitle = '',
  onLog = null,
} = {}) {
  const startTime = Date.now();
  // Plan role: the outline drives the whole deck's structure and type
  // selection, so the Claude vendor uses a stronger model here (Opus).
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor, role: 'plan' });

  const detectedLang = detectDeckLanguage(rawContent);
  const requestedLang = normalizeLang(targetLang);

  // Calculate target slide count based on content and user preference
  const { targetSlides, estimatedInputLines } = calculateTargetSlides(rawContent, targetLength);
  console.log(`[Phase1] Target: ${targetSlides} slides for ${estimatedInputLines} lines (targetLength: ${targetLength})`);

  const systemPrompt = prompts.buildPhase1SystemPrompt({
    detectedLang,
    requestedLang,
    targetSlides,
    estimatedInputLines,
  });

  const userPrompt = prompts.buildPhase1UserPrompt({
    rawContent,
    userName: String(userName || '').trim(),
    rawFirstSlideTitle: String(rawFirstSlideTitle || '').trim(),
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const rawResponse = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.3,
    responseFormat: { type: 'json_object' },
    // Headroom: current Claude models spend part of the output budget on
    // (adaptive) thinking, and large decks produce long outlines.
    maxTokens: 16000,
    messages,
  });

  const parsed = extractJsonObject(rawResponse);
  if (!parsed) {
    throw LlmError.fromJsonParseFailure(rawResponse, {
      phase: 'outline',
      vendor: resolvedVendor,
      model,
    });
  }

  const outline = normalizePhase1Output(parsed);

  // Add metadata
  outline.metadata = {
    detectedLang: detectedLang.code,
    requestedLang,
    vendor: resolvedVendor,
    model,
    durationMs: Date.now() - startTime,
  };

  // Call logging callback if provided
  if (typeof onLog === 'function') {
    onLog({
      input: { rawContent: rawContent.slice(0, 2000), userName, targetLang },
      messages,
      output: outline,
      rawResponse,
      metadata: outline.metadata,
    });
  }

  return outline;
}

/**
 * Separate slides into structural (resolved directly) and content (need Phase 2)
 *
 * @param {Array} slides - Slides from outline
 * @returns {Object} { structuralSlides, contentGroups }
 */
export function separateSlidesForProcessing(slides) {
  const structuralSlides = [];
  const contentGroups = [];
  const groupMap = new Map();

  for (const slide of slides) {
    // Structural slides (chapter, quote, closing) are resolved directly
    if (['chapter', 'quote', 'closing'].includes(slide.intent)) {
      const resolved = resolveStructuralSlide(slide);
      if (resolved) {
        structuralSlides.push(resolved);
      }
      continue;
    }

    // Content slides go to Phase 2 for AI refinement
    if (slide.intent === 'content') {
      const gid = slide.groupId || `ungrouped-${slide.index}`;
      if (!groupMap.has(gid)) {
        groupMap.set(gid, []);
      }
      groupMap.get(gid).push(slide);
    }
  }

  // Group content slides (max 4 per group)
  for (const [groupId, slideList] of groupMap) {
    if (slideList.length === 0) continue;

    for (let i = 0; i < slideList.length; i += 4) {
      const chunk = slideList.slice(i, i + 4);
      contentGroups.push({
        groupId: chunk.length > 1 ? groupId : `single-${chunk[0].index}`,
        slides: chunk,
        intent: 'content',
      });
    }
  }

  // Sort content groups by first slide's index
  contentGroups.sort((a, b) => a.slides[0].index - b.slides[0].index);

  return { structuralSlides, contentGroups };
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use separateSlidesForProcessing instead
 */
export function groupSlidesForPhase2(slides) {
  const { contentGroups } = separateSlidesForProcessing(slides);
  return contentGroups;
}