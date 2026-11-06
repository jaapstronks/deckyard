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
import { LlmError } from '../llm/error.js';
import {
  requestChatCompletionContent,
  starterRequest,
  untrustedData,
} from '../llm/index.js';
import { extractJsonObject, safeJsonParse } from '../openai/json.js';
import { buildPhase2CatalogPrompt } from './slide-type-catalog.js';
import { validateAndFixSlide } from './validate-slides/index.js';
import { dropForeignMedia, leaveOut, mediaInSlides } from './model-media.js';
import { prompts } from './prompts/index.js';

/**
 * Supported iteration commands and their prompt strategies
 */
const COMMAND_PATTERNS = {
  punchier: {
    keywords: [
      'punchier',
      'shorter',
      'concise',
      'tighter',
      'brevity',
      'trim',
      'shorten',
    ],
    strategy: 'compress',
    description: 'Make content more concise and impactful',
  },
  split: {
    keywords: [
      'split',
      'break up',
      'divide',
      'too long',
      'too dense',
      'too much',
    ],
    strategy: 'split',
    description: 'Split an overloaded slide into multiple slides',
  },
  variety: {
    keywords: [
      'variety',
      'visual',
      'diverse',
      'mix up',
      'different types',
      'boring',
      'repetitive',
    ],
    strategy: 'diversify',
    description: 'Suggest type conversions for visual diversity',
  },
  expand: {
    keywords: [
      'expand',
      'more detail',
      'elaborate',
      'add more',
      'flesh out',
      'deeper',
    ],
    strategy: 'expand',
    description: 'Add more detail or content to a slide',
  },
  retype: {
    keywords: [
      'convert',
      'change type',
      'retype',
      'different layout',
      'as a list',
      'as cards',
      'as blocks',
    ],
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
    const score = pattern.keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = name;
    }
  }

  return bestMatch || 'general';
}

/**
 * Detect whether the starter's command names one slide by its number
 * ("slide 3", "slide #3", "the 3rd slide") or by its type ("the kpi slide").
 * Only the command is read: a slide's own title never decides the target,
 * because collaborators write titles and the starter does not (DY-812).
 *
 * @param {string} command - The starter's instruction
 * @param {Array} slides - The deck's slides
 * @returns {number|null} 0-based index, or null for no named slide
 */
export function detectTargetSlide(command, slides) {
  const lower = command.toLowerCase();

  const indexMatch =
    lower.match(/slide\s*#?\s*(\d+)/i) ||
    lower.match(/(\d+)(?:st|nd|rd|th)\s+slide/i);
  if (indexMatch) {
    const idx = parseInt(indexMatch[1], 10) - 1; // 1-indexed to 0-indexed
    if (idx >= 0 && idx < slides.length) return idx;
  }

  const typeMatch = lower.match(/the\s+([\w-]+)\s+slide/i);
  if (typeMatch) {
    const typeName = typeMatch[1].toLowerCase();
    const idx = slides.findIndex((s) =>
      String(s?.type || '')
        .toLowerCase()
        .includes(typeName),
    );
    if (idx >= 0) return idx;
  }

  return null;
}

/**
 * Bound a model's plan to what the starter authorized (DY-812). A plan is
 * the model's answer, and the model read collaborator text, so it may ask
 * for anything; what it may write is decided here, not in the prompt.
 *
 * - `remove` is never written: it becomes a proposal the starter acts on
 *   with their own write (MCP `remove_slide`, the editor).
 * - With `allowed`, a modification of a slide outside that set becomes a
 *   proposal too. `allowed` null means the starter gave a deck-wide command.
 * - A modification with no valid index or an unknown action is dropped.
 *
 * @param {{ modifications?: Array, summary?: string }} plan
 * @param {Set<number>|null} allowed - Indexes the starter pointed at
 * @param {number} slideCount
 * @returns {{ modifications: Array, proposals: Array, summary: string }}
 */
export function scopePlan(plan, allowed, slideCount) {
  const modifications = [];
  const proposals = [];
  for (const mod of plan?.modifications || []) {
    const idx = mod?.slideIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= slideCount) continue;
    if (mod.action === 'remove') {
      proposals.push(mod);
    } else if (mod.action !== 'replace' && mod.action !== 'split') {
      continue;
    } else if (allowed && !allowed.has(idx)) {
      proposals.push(mod);
    } else {
      modifications.push(mod);
    }
  }
  return {
    modifications,
    proposals,
    summary: plan?.summary || 'No changes suggested.',
  };
}

/**
 * Build a concise slide summary for the AI prompt
 */
function summarizeSlide(slide, index) {
  const content = slide.content || {};
  const title = content.title || '(no title)';
  const itemCount =
    content.items?.length ||
    content.rows?.length ||
    content.metrics?.length ||
    '';
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
 * @param {Record<string, Object>} options.slideTypes - The organization's
 *   merged type map; the modified slide is fixed against it (B247)
 * @returns {Promise<Object|Array>} Modified slide(s)
 */
export async function iterateSlide(
  slide,
  command,
  {
    lang = 'en',
    vendor = null,
    disabledSlideTypes = [],
    customSlideTypes = [],
    deckContext = [],
    slideTypes,
  } = {},
) {
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });
  const strategy = detectCommandPattern(command);
  const catalogPrompt = buildPhase2CatalogPrompt({
    disabledSlideTypes,
    customSlideTypes,
  });

  const systemPrompt = prompts.buildSlideIterationPrompt({
    strategy,
    lang,
    catalogPrompt,
  });

  const contextSection = deckContext.length
    ? `\nDECK CONTEXT (surrounding slides):\n${untrustedData(deckContext.join('\n'))}\n`
    : '';

  const userPrompt = `INSTRUCTION:
${starterRequest(command)}
${contextSection}
SLIDE TO MODIFY:
${untrustedData(JSON.stringify({ type: slide.type, content: slide.content }, null, 2))}`;

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
    const parts = ownMediaOnly(
      result.map((s) => validateAndFixSlide(s, { slideTypes })),
      [slide],
      slideTypes,
    );
    if (result.length && !parts.length) throw unusableAnswer(resolvedVendor);
    return parts;
  } else {
    result = extractJsonObject(rawResponse);
    const [fixed] = ownMediaOnly(
      [validateAndFixSlide(result, { slideTypes })],
      [slide],
      slideTypes,
    );
    if (!fixed) throw unusableAnswer(resolvedVendor);
    return fixed;
  }
}

/**
 * Hold a model's slides to the media the slides it was shown already held
 * (DY-811): it rewrites text and structure, it does not choose what a
 * viewer's browser loads. A slide left without a reference its type requires
 * is not in the answer.
 *
 * @param {Object[]} written - Slides out of `validateAndFixSlide`
 * @param {Object[]} shown - The slides the model was given
 * @param {Record<string, Object>} slideTypes
 * @returns {Object[]} The slides that can be stored, mutated
 */
function ownMediaOnly(written, shown, slideTypes) {
  const unusable = dropForeignMedia(written, {
    slideTypes,
    keep: mediaInSlides(shown, slideTypes),
  });
  return leaveOut(written, unusable);
}

/** The one slide the starter pointed at came back unusable: the model failed. */
function unusableAnswer(vendor) {
  return new LlmError(
    'The model answered a slide that cannot be used: it was built around an embed or video the slide does not hold.',
    { phase: 'iterate', vendor },
  );
}

/**
 * Iterate on an entire deck
 *
 * @param {Object} deck - The full deck object
 * @param {string} command - Natural language instruction
 * @param {Object} options
 * @param {Record<string, Object>} options.slideTypes - The organization's
 *   merged type map; replacement slides are fixed against it (B247)
 * @returns {Promise<Object>} Modification plan with changes and summary
 */
export async function iterateDeck(
  deck,
  command,
  {
    lang = 'en',
    vendor = null,
    disabledSlideTypes = [],
    customSlideTypes = [],
    slideTypes,
  } = {},
) {
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });
  const strategy = detectCommandPattern(command);
  const catalogPrompt = buildPhase2CatalogPrompt({
    disabledSlideTypes,
    customSlideTypes,
  });

  const systemPrompt = prompts.buildDeckIterationPrompt({
    strategy,
    lang,
    catalogPrompt,
  });

  const slides = deck.slides || [];
  const slideSummaries = slides.map((s, i) => summarizeSlide(s, i));

  const userPrompt = `INSTRUCTION:
${starterRequest(command)}

${untrustedData(`DECK: "${deck.title || 'Untitled'}" (${slides.length} slides)

SLIDE OVERVIEW:
${slideSummaries.join('\n')}

FULL SLIDE DATA:
${JSON.stringify(
  slides.map((s, i) => ({
    index: i,
    type: s.type,
    content: s.content,
  })),
  null,
  2,
)}`)}`;

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

  // Validate all replacement slides in the plan. A modification whose slides
  // cannot be stored is not in the plan: the slide it named stays as it is.
  const usable = [];
  for (const mod of plan.modifications) {
    if (mod.action === 'replace' && mod.slide) {
      [mod.slide] = ownMediaOnly(
        [validateAndFixSlide(mod.slide, { slideTypes })],
        slides,
        slideTypes,
      );
      if (!mod.slide) continue;
    }
    if (mod.action === 'split' && mod.slides) {
      const written = mod.slides.length;
      mod.slides = ownMediaOnly(
        mod.slides.map((s) => validateAndFixSlide(s, { slideTypes })),
        slides,
        slideTypes,
      );
      if (written && !mod.slides.length) continue;
    }
    usable.push(mod);
  }
  if (usable.length < plan.modifications.length) {
    plan.summary =
      `${plan.summary || ''} A change built around an embed or video the deck does not hold was left out.`.trim();
  }
  plan.modifications = usable;

  return plan;
}

/**
 * Apply a scoped plan to a deck, producing a new deck. Only `replace` and
 * `split` exist here: a plan never deletes a slide (`scopePlan`).
 *
 * @param {Object} deck - Original deck
 * @param {Object} plan - A plan from `scopePlan()`
 * @returns {Object} New deck with modifications applied
 */
export function applyIterationPlan(deck, plan) {
  if (!plan?.modifications?.length) return deck;

  const newDeck = { ...deck, slides: [...deck.slides] };
  const mods = [...plan.modifications].sort(
    (a, b) => (b.slideIndex || 0) - (a.slideIndex || 0),
  );

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
 * The starter decides which slides the plan may write (DY-812):
 * `targetSlideIndexes` lists the slides they pointed at (the editor's open
 * slide, MCP `apply`); null means they gave a deck-wide command. One pointed
 * slide is the target; otherwise a slide the command names by number or type
 * is, when it is in the set. The plan is then bounded by `scopePlan`.
 *
 * @param {Object} deck - The deck
 * @param {string} command - Natural language command
 * @param {Object} options
 * @param {number[]|null} [options.targetSlideIndexes] - 0-based indexes
 * @returns {Promise<Object>} { deck, plan, targetSlideIndex }
 */
export async function iteratePresentation(deck, command, options = {}) {
  const slides = deck.slides || [];
  const { targetSlideIndexes = null, ...iterateOptions } = options;
  const allowed = Array.isArray(targetSlideIndexes)
    ? new Set(
        targetSlideIndexes.filter(
          (i) => Number.isInteger(i) && i >= 0 && i < slides.length,
        ),
      )
    : null;

  const named = detectTargetSlide(command, slides);
  let targetIndex = null;
  if (allowed && allowed.size === 1) {
    [targetIndex] = allowed;
  } else if (named !== null && (!allowed || allowed.has(named))) {
    targetIndex = named;
  }
  if (allowed && allowed.size === 0) {
    return {
      deck,
      plan: scopePlan(null, allowed, slides.length),
      targetSlideIndex: null,
    };
  }

  let rawPlan;
  if (targetIndex !== null) {
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

    rawPlan = Array.isArray(result)
      ? {
          modifications: [
            {
              slideIndex: targetIndex,
              action: 'split',
              slides: result,
              reasoning: result[0]?.reasoning || command,
            },
          ],
          summary: `Split slide ${targetIndex + 1} into ${result.length} slides.`,
        }
      : {
          modifications: [
            {
              slideIndex: targetIndex,
              action: 'replace',
              slide: result,
              reasoning: result?.reasoning || command,
            },
          ],
          summary: `Modified slide ${targetIndex + 1}.`,
        };
  } else {
    rawPlan = await iterateDeck(deck, command, iterateOptions);
  }

  const plan = scopePlan(rawPlan, allowed, slides.length);
  return {
    deck: applyIterationPlan(deck, plan),
    plan,
    targetSlideIndex: targetIndex,
  };
}
