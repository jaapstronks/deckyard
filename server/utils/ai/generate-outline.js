/**
 * Phase 1: Outline Generation
 *
 * Creates a presentation outline from raw content WITHOUT knowing about
 * specific slide types, in two calls with one job each (see
 * `prompts/base/outline.js`):
 *
 * 1. Analysis: what the source contains (sections, key points, excerpts).
 * 2. Structure: the slide plan within the budget (intents, rough content,
 *    hints, grouping), built from the analysis alone.
 *
 * Each outline slide carries its section of the analysis as `sourceContext`,
 * so Phase 2 sees what the source said, not only the plan's paraphrase.
 * Status lines for the loading UI are derived from the analysis in code.
 */

import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent, LlmError } from '../llm/index.js';
import { extractJsonObject } from '../openai/json.js';
import { detectDeckLanguage, normalizeLang } from '../openai/lang.js';
import { prompts } from './prompts/index.js';
import { createLogger } from '../logger.js';

const log = createLogger('generate-outline');

/**
 * Calculate target slide count based on content length and user preference
 *
 * @param {string} rawContent - The source content
 * @param {string} targetLength - 'auto', '5min', '10min', '20min', '30min'
 * @returns {{ targetSlides: number, estimatedInputLines: number }}
 */
export function calculateTargetSlides(rawContent, targetLength) {
  const lines = rawContent.split('\n').filter((l) => l.trim()).length;
  const words = rawContent.split(/\s+/).filter((w) => w.trim()).length;

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

const trimmed = (value) => String(value ?? '').trim();

/**
 * Validate and normalize the analysis call's output.
 *
 * @param {object} parsed
 * @returns {{ title: string, subtitle: string, summary: string, sections: Array<object> }}
 */
export function normalizeAnalysis(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Outline analysis did not return valid JSON');
  }
  const sections = (Array.isArray(parsed.sections) ? parsed.sections : [])
    .map((s) => ({
      heading: trimmed(s?.heading),
      importance: ['high', 'medium', 'low'].includes(trimmed(s?.importance))
        ? trimmed(s.importance)
        : 'medium',
      keyPoints: (Array.isArray(s?.keyPoints) ? s.keyPoints : [])
        .map(trimmed)
        .filter(Boolean),
      excerpt: trimmed(s?.excerpt),
      quotes: (Array.isArray(s?.quotes) ? s.quotes : [])
        .map((q) => ({
          text: trimmed(q?.text),
          author: trimmed(q?.author),
          role: trimmed(q?.role),
        }))
        .filter((q) => q.text),
    }))
    .filter((s) => s.heading || s.keyPoints.length);

  return {
    title: trimmed(parsed.title) || 'Untitled Presentation',
    subtitle: trimmed(parsed.subtitle),
    summary: trimmed(parsed.summary),
    sections,
  };
}

/**
 * Validate and normalize the structure call's output into outline slides.
 * Opening slides are dropped (the title slide is added downstream), and each
 * slide gets its analysis section as `sourceContext`.
 *
 * @param {object} parsed
 * @param {{ sections: Array<object> }} analysis
 * @returns {Array<object>}
 */
export function normalizeStructure(parsed, analysis) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Outline structure did not return valid JSON');
  }
  const slides = [];
  for (const slide of Array.isArray(parsed.slides) ? parsed.slides : []) {
    const intent = normalizeIntent(slide?.intent);
    if (intent === 'opening') continue;
    const section = analysis.sections[Number(slide?.section)] || null;
    slides.push({
      index: slides.length,
      intent,
      roughContent: trimmed(slide?.roughContent),
      presenterNotes: '',
      hints: Array.isArray(slide?.hints) ? slide.hints.map(trimmed) : [],
      groupId: slide?.groupId != null ? trimmed(slide.groupId) : null,
      sourceContext: section
        ? {
            heading: section.heading,
            keyPoints: section.keyPoints,
            excerpt: section.excerpt,
          }
        : null,
    });
  }

  if (slides.length === 0) {
    slides.push({
      index: 0,
      intent: 'content',
      roughContent: 'Overview',
      presenterNotes: '',
      hints: [],
      groupId: null,
      sourceContext: null,
    });
  }
  return slides;
}

const STATUS_COPY = {
  nl: {
    section: (heading) => `Slides maken over ${heading}...`,
    generic: [
      'Structuur bepalen...',
      'Slide-types kiezen...',
      'Details toevoegen...',
      'Afwerking toevoegen...',
    ],
  },
  en: {
    section: (heading) => `Creating slides about ${heading}...`,
    generic: [
      'Planning the structure...',
      'Choosing slide types...',
      'Adding details...',
      'Finishing touches...',
    ],
  },
};

/**
 * Status lines for the loading UI, derived from the analysis: one per section
 * (at most six), padded with generic lines to at least six. Written in code
 * rather than asked of a model call that has more important work.
 *
 * @param {{ sections: Array<{ heading: string }> }} analysis
 * @param {string} lang - 'nl' or anything else (English)
 * @returns {string[]}
 */
export function buildStatusMessages(analysis, lang) {
  const copy = String(lang || '').startsWith('nl')
    ? STATUS_COPY.nl
    : STATUS_COPY.en;
  const messages = analysis.sections
    .map((s) => s.heading)
    .filter(Boolean)
    .slice(0, 6)
    .map(copy.section);
  for (const line of copy.generic) {
    if (messages.length >= 6) break;
    messages.push(line);
  }
  return messages;
}

/**
 * Normalize intent value
 */
function normalizeIntent(intent) {
  const valid = ['opening', 'chapter', 'content', 'quote', 'closing'];
  const normalized = String(intent || 'content')
    .toLowerCase()
    .trim();
  return valid.includes(normalized) ? normalized : 'content';
}

/**
 * Convert a structural slide (chapter/quote/closing) to its final form
 * These don't need AI refinement - they're simple enough to resolve directly.
 */
function resolveStructuralSlide(slide) {
  const { intent, roughContent, index, presenterNotes } = slide;

  if (intent === 'chapter') {
    const lines = roughContent
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
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
    const lines = roughContent
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
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
 * One JSON-returning call of the outline, with the plan-role model.
 * @returns {Promise<{ parsed: object, messages: Array, rawResponse: string }>}
 */
async function requestOutlineStep(
  step,
  { systemPrompt, userPrompt, maxTokens, llm, signal },
) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const rawResponse = await requestChatCompletionContent({
    vendor: llm.vendor,
    apiKey: llm.apiKey,
    model: llm.model,
    temperature: 0.3,
    responseFormat: { type: 'json_object' },
    // Headroom: current Claude models spend part of the output budget on
    // (adaptive) thinking.
    maxTokens,
    messages,
    signal,
  });
  const parsed = extractJsonObject(rawResponse);
  if (!parsed) {
    throw LlmError.fromJsonParseFailure(rawResponse, {
      phase: `outline-${step}`,
      vendor: llm.vendor,
      model: llm.model,
    });
  }
  return { parsed, messages, rawResponse };
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
 * @param {AbortSignal} [options.signal] - Reaches the provider fetch, so a
 *   caller whose reader left (an SSE client that disconnected) cancels the
 *   model call instead of paying for an outline nobody reads.
 * @returns {Promise<Object>} The presentation outline
 */
export async function generateOutline(
  rawContent,
  {
    userName = '',
    targetLang = null,
    vendor = null,
    targetLength = 'auto',
    rawFirstSlideTitle = '',
    onLog = null,
    signal = null,
  } = {},
) {
  const startTime = Date.now();
  // Plan role: the outline drives the whole deck's structure, so the Claude
  // vendor uses a stronger model here (Opus) unless pinned otherwise.
  const llm = getLlmConfig({ vendor, role: 'plan' });

  const detectedLang = detectDeckLanguage(rawContent);
  const requestedLang = normalizeLang(targetLang);

  const { targetSlides, estimatedInputLines } = calculateTargetSlides(
    rawContent,
    targetLength,
  );
  log.info(
    `Target: ${targetSlides} slides for ${estimatedInputLines} lines (targetLength: ${targetLength})`,
  );

  // Step 1: what the source contains.
  const analysisStep = await requestOutlineStep('analysis', {
    systemPrompt: prompts.buildAnalysisSystemPrompt({
      detectedLang,
      requestedLang,
    }),
    userPrompt: prompts.buildAnalysisUserPrompt({
      rawContent,
      userName: trimmed(userName),
      rawFirstSlideTitle: trimmed(rawFirstSlideTitle),
    }),
    maxTokens: 16000,
    llm,
    signal,
  });
  const analysis = normalizeAnalysis(analysisStep.parsed);

  // Step 2: the slide plan, from the analysis alone.
  const structureStep = await requestOutlineStep('structure', {
    systemPrompt: prompts.buildStructureSystemPrompt({
      detectedLang,
      requestedLang,
      targetSlides,
    }),
    userPrompt: prompts.buildStructureUserPrompt({ analysis }),
    maxTokens: 12000,
    llm,
    signal,
  });
  const slides = normalizeStructure(structureStep.parsed, analysis);

  const outline = {
    title: analysis.title,
    subtitle: analysis.subtitle,
    summary: analysis.summary,
    statusMessages: buildStatusMessages(
      analysis,
      requestedLang || detectedLang.code,
    ),
    chapters: slides
      .filter((s) => s.intent === 'chapter')
      .map((s) => ({
        title: s.roughContent.split('\n')[0] || '',
        slideIndexes: [s.index],
      })),
    slides,
    analysis,
    metadata: {
      detectedLang: detectedLang.code,
      requestedLang,
      vendor: llm.vendor,
      model: llm.model,
      calls: 2,
      durationMs: Date.now() - startTime,
    },
  };

  if (typeof onLog === 'function') {
    onLog({
      input: { rawContent: rawContent.slice(0, 2000), userName, targetLang },
      messages: {
        analysis: analysisStep.messages,
        structure: structureStep.messages,
      },
      output: outline,
      rawResponse: {
        analysis: analysisStep.rawResponse,
        structure: structureStep.rawResponse,
      },
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
