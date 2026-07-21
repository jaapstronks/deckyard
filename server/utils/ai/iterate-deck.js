/**
 * Iterative Deck Refinement
 *
 * Takes an existing deck and a natural language command, returns a modified deck.
 * Commands like "make this punchier", "split slide 3", "add more visuals".
 *
 * Operates in two modes:
 * 1. Slide-scoped: modify a specific slide ("make slide 3 shorter")
 * 2. Deck-scoped: modify the whole deck ("more visual variety", "shorten everything")
 */

import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent, LlmError } from '../llm/index.js';
import { extractJsonObject, safeJsonParse } from '../openai/json.js';
import { buildPhase2CatalogPrompt } from './slide-type-catalog.js';
import { validateAndFixSlide } from './validate-slides.js';
import { prompts } from './prompts/index.js';

/**
 * Supported iteration commands and their prompt strategies
 */
const COMMAND_PATTERNS = {
  punchier: {
    keywords: ['punchier', 'shorter', 'concise', 'tighter', 'brevity', 'trim', 'shorten'],
    strategy: 'compress',
    description: 'Make content more concise and impactful',
  },
  split: {
    keywords: ['split', 'break up', 'divide', 'too long', 'too dense', 'too much'],
    strategy: 'split',
    description: 'Split an overloaded slide into multiple slides',
  },
  variety: {
    keywords: ['variety', 'visual', 'diverse', 'mix up', 'different types', 'boring', 'repetitive'],
    strategy: 'diversify',
    description: 'Suggest type conversions for visual diversity',
  },
  expand: {
    keywords: ['expand', 'more detail', 'elaborate', 'add more', 'flesh out', 'deeper'],
    strategy: 'expand',
    description: 'Add more detail or content to a slide',
  },
  retype: {
    keywords: ['convert', 'change type', 'retype', 'different layout', 'as a list', 'as cards', 'as blocks'],
    strategy: 'retype',
    description: 'Convert a slide to a different type',
  },
};

/**
 * Detect which command pattern best matches the user's instruction
 */
function detectCommandPattern(command) {
  const lower = command.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const [name, pattern] of Object.entries(COMMAND_PATTERNS)) {
    const score = pattern.keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = name;
    }
  }

  return bestMatch || 'general';
}

/**
 * Detect if the command targets a specific slide (by index or by content reference)
 */
function detectTargetSlide(command, slides) {
  const lower = command.toLowerCase();

  // Match "slide 3", "slide #3", "the 3rd slide"
  const indexMatch = lower.match(/slide\s*#?\s*(\d+)/i)
    || lower.match(/(\d+)(?:st|nd|rd|th)\s+slide/i);
  if (indexMatch) {
    const idx = parseInt(indexMatch[1], 10) - 1; // 1-indexed to 0-indexed
    if (idx >= 0 && idx < slides.length) return idx;
  }

  // Match "the title slide", "the KPI slide", etc.
  const typeMatch = lower.match(/the\s+([\w-]+)\s+slide/i);
  if (typeMatch) {
    const typeName = typeMatch[1].toLowerCase();
    const idx = slides.findIndex(s =>
      s.type?.toLowerCase().includes(typeName) ||
      s.content?.title?.toLowerCase().includes(typeName)
    );
    if (idx >= 0) return idx;
  }

  return null; // Deck-scoped
}

/**
 * Build a concise slide summary for the AI prompt
 */
function summarizeSlide(slide, index) {
  const content = slide.content || {};
  const title = content.title || content.tagline || '(no title)';
  const itemCount = content.items?.length || content.rows?.length || content.metrics?.length || '';
  const extra = itemCount ? ` [${itemCount} items]` : '';
  return `[${index + 1}] ${slide.type}: "${title}"${extra}`;
}

/**
 * Iterate on a single slide
 *
 * @param {Object} slide - The slide to modify
 * @param {string} command - Natural language instruction
 * @param {Object} options
 * @param {string} options.lang - Language code
 * @param {string} options.vendor - LLM vendor
 * @param {Array} options.disabledSlideTypes - Types to exclude
 * @param {Array} options.customSlideTypes - Custom types to include
 * @param {Array} options.deckContext - Brief summary of surrounding slides for context
 * @returns {Promise<Object|Array>} Modified slide(s)
 */
export async function iterateSlide(slide, command, {
  lang = 'en',
  vendor = null,
  disabledSlideTypes = [],
  customSlideTypes = [],
  deckContext = [],
} = {}) {
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });
  const strategy = detectCommandPattern(command);
  const catalogPrompt = buildPhase2CatalogPrompt({ disabledSlideTypes, customSlideTypes });

  const systemPrompt = prompts.buildSlideIterationPrompt({
    command,
    strategy,
    lang,
    catalogPrompt,
  });

  const contextSection = deckContext.length
    ? `\nDECK CONTEXT (surrounding slides):\n${deckContext.join('\n')}\n`
    : '';

  const userPrompt = `${contextSection}
SLIDE TO MODIFY:
${JSON.stringify({ type: slide.type, content: slide.content }, null, 2)}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const rawResponse = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    messages,
    temperature: 0.4,
    maxTokens: 4000,
  });

  // Parse response — could be single object or array (for split)
  let result;
  if (strategy === 'split') {
    // Try parsing as array first (the AI might return a raw array)
    const parsed = safeJsonParse(rawResponse);
    if (Array.isArray(parsed)) {
      result = parsed;
    } else {
      // Might be wrapped in an object with a slides key
      const obj = parsed || extractJsonObject(rawResponse);
      result = obj?.slides || (obj ? [obj] : []);
    }
    // Validate each split slide
    return result.map(s => validateAndFixSlide(s));
  } else {
    result = extractJsonObject(rawResponse);
    return validateAndFixSlide(result);
  }
}

/**
 * Iterate on an entire deck
 *
 * @param {Object} deck - The full deck object
 * @param {string} command - Natural language instruction
 * @param {Object} options
 * @returns {Promise<Object>} Modification plan with changes and summary
 */
export async function iterateDeck(deck, command, {
  lang = 'en',
  vendor = null,
  disabledSlideTypes = [],
  customSlideTypes = [],
} = {}) {
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });
  const strategy = detectCommandPattern(command);
  const catalogPrompt = buildPhase2CatalogPrompt({ disabledSlideTypes, customSlideTypes });

  const systemPrompt = prompts.buildDeckIterationPrompt({
    command,
    strategy,
    lang,
    catalogPrompt,
  });

  const slides = deck.slides || [];
  const slideSummaries = slides.map((s, i) => summarizeSlide(s, i));

  const userPrompt = `DECK: "${deck.title || 'Untitled'}" (${slides.length} slides)

SLIDE OVERVIEW:
${slideSummaries.join('\n')}

FULL SLIDE DATA:
${JSON.stringify(slides.map((s, i) => ({
  index: i,
  type: s.type,
  content: s.content,
})), null, 2)}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const rawResponse = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    messages,
    temperature: 0.4,
    maxTokens: 8000,
  });

  const plan = extractJsonObject(rawResponse);
  if (!plan?.modifications) {
    return { modifications: [], summary: 'No changes suggested.' };
  }

  // Validate all replacement slides in the plan
  for (const mod of plan.modifications) {
    if (mod.action === 'replace' && mod.slide) {
      mod.slide = validateAndFixSlide(mod.slide);
    }
    if (mod.action === 'split' && mod.slides) {
      mod.slides = mod.slides.map(s => validateAndFixSlide(s));
    }
  }

  return plan;
}

/**
 * Apply a modification plan to a deck, producing a new deck
 *
 * @param {Object} deck - Original deck
 * @param {Object} plan - Modification plan from iterateDeck()
 * @returns {Object} New deck with modifications applied
 */
export function applyIterationPlan(deck, plan) {
  if (!plan?.modifications?.length) return deck;

  const newDeck = { ...deck, slides: [...deck.slides] };
  const mods = [...plan.modifications].sort((a, b) => (b.slideIndex || 0) - (a.slideIndex || 0));

  for (const mod of mods) {
    const idx = mod.slideIndex;
    if (idx < 0 || idx >= newDeck.slides.length) continue;

    switch (mod.action) {
      case 'replace':
        if (mod.slide) {
          // Preserve original slide's id and notes
          newDeck.slides[idx] = {
            ...newDeck.slides[idx],
            type: mod.slide.type,
            content: mod.slide.content,
            _aiReasoning: mod.reasoning || '',
          };
        }
        break;

      case 'remove':
        newDeck.slides.splice(idx, 1);
        break;

      case 'split':
        if (mod.slides?.length) {
          const originalSlide = newDeck.slides[idx];
          const newSlides = mod.slides.map((s, i) => ({
            ...originalSlide,
            id: i === 0 ? originalSlide.id : `${originalSlide.id}-split-${i}`,
            type: s.type,
            content: s.content,
            _aiReasoning: mod.reasoning || '',
          }));
          newDeck.slides.splice(idx, 1, ...newSlides);
        }
        break;
    }
  }

  return newDeck;
}

/**
 * High-level: iterate on a deck or slide based on a command
 *
 * @param {Object} deck - The deck
 * @param {string} command - Natural language command
 * @param {Object} options
 * @returns {Promise<Object>} { deck, plan, targetSlideIndex }
 */
export async function iteratePresentation(deck, command, options = {}) {
  const slides = deck.slides || [];

  // The refine panel is per-slide: it passes the slide currently being edited
  // as `currentSlideIndex`. A command that explicitly names another slide
  // ("make slide 3 punchier") still wins; otherwise we scope to the edited
  // slide instead of sending the whole deck to the LLM — much faster, and it
  // matches what "make this punchier" means in a per-slide box.
  const { currentSlideIndex, ...iterateOptions } = options;
  const explicitTarget = detectTargetSlide(command, slides);
  const hintedTarget =
    Number.isInteger(currentSlideIndex) &&
    currentSlideIndex >= 0 &&
    currentSlideIndex < slides.length
      ? currentSlideIndex
      : null;
  const targetIndex = explicitTarget !== null ? explicitTarget : hintedTarget;

  if (targetIndex !== null) {
    // Slide-scoped iteration
    const slide = slides[targetIndex];
    const contextWindow = 2;
    const start = Math.max(0, targetIndex - contextWindow);
    const end = Math.min(slides.length, targetIndex + contextWindow + 1);
    const deckContext = slides
      .slice(start, end)
      .filter((_, i) => start + i !== targetIndex)
      .map((s, i) => summarizeSlide(s, start + i));

    const result = await iterateSlide(slide, command, {
      ...iterateOptions,
      deckContext,
    });

    // Build a plan from the single-slide result
    let plan;
    if (Array.isArray(result)) {
      // Split
      plan = {
        modifications: [{
          slideIndex: targetIndex,
          action: 'split',
          slides: result,
          reasoning: result[0]?.reasoning || command,
        }],
        summary: `Split slide ${targetIndex + 1} into ${result.length} slides.`,
      };
    } else {
      plan = {
        modifications: [{
          slideIndex: targetIndex,
          action: 'replace',
          slide: result,
          reasoning: result?.reasoning || command,
        }],
        summary: `Modified slide ${targetIndex + 1}.`,
      };
    }

    const newDeck = applyIterationPlan(deck, plan);
    return { deck: newDeck, plan, targetSlideIndex: targetIndex };
  } else {
    // Deck-scoped iteration (no explicit target and no per-slide hint, e.g. a
    // deck-level surface).
    const plan = await iterateDeck(deck, command, iterateOptions);
    const newDeck = applyIterationPlan(deck, plan);
    return { deck: newDeck, plan, targetSlideIndex: null };
  }
}
