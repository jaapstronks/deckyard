/**
 * Deck Compression
 *
 * Analyzes a presentation and suggests consolidation opportunities:
 * - Slides with overlapping content that should be merged
 * - Slides that add little value and could be removed
 * - Slides that could be combined into a single summary slide
 */

import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent, LlmError } from '../llm/index.js';
import { extractJsonObject } from '../openai/json.js';

/**
 * Extract a title or summary from a slide for the compression prompt
 */
function extractSlideTitle(slide) {
  const content = slide?.content || {};
  return (
    content.title ||
    content.quote?.slice(0, 60) ||
    content.tagline ||
    content.card1Title ||
    content.row1Block1Title ||
    (content.items?.[0]?.title || content.items?.[0]?.text)?.slice(0, 60) ||
    'Untitled'
  );
}

/**
 * Build the system prompt for deck compression analysis
 */
function buildCompressionSystemPrompt({ targetReduction }) {
  const aggressiveness = targetReduction === 'aggressive'
    ? 'Be aggressive - recommend removing or merging as many slides as reasonable while keeping core content.'
    : 'Be moderate - recommend clear improvements but preserve important content.';

  return `You are a presentation editor analyzing a deck for consolidation opportunities.

${aggressiveness}

Your job is to identify:
1. MERGES: Slides with overlapping or highly related content that should be combined
2. REMOVALS: Slides that are redundant, too similar to others, or add little value
3. Overall recommendation

Rules:
- Never suggest removing title slides (type: title-slide) or closing slides (type: payoff-slide)
- Be cautious about removing chapter slides - only if they serve no purpose
- Focus on content redundancy, not slide type similarity
- Consider the narrative flow - don't break logical progressions

Return ONLY valid JSON:
{
  "merges": [
    {
      "slideIndexes": [2, 3],
      "reason": "Both cover marketing responsibilities",
      "mergedTitle": "Suggested title for merged slide"
    }
  ],
  "removals": [
    {
      "slideIndex": 5,
      "reason": "Repeats content from slide 3"
    }
  ],
  "summary": "Recommended reducing from X to Y slides",
  "originalCount": <number>,
  "recommendedCount": <number>
}`;
}

/**
 * Build the user prompt for compression analysis
 */
function buildCompressionUserPrompt({ title, slides }) {
  const lines = [
    `PRESENTATION: ${title}`,
    `TOTAL SLIDES: ${slides.length}`,
    '',
    'SLIDES:',
  ];

  slides.forEach((slide, idx) => {
    const slideTitle = extractSlideTitle(slide);
    const type = slide?.type || 'unknown';
    lines.push(`[${idx}] ${type}: ${slideTitle}`);

    // Include brief content hints for content-heavy slides
    const content = slide?.content || {};
    if (content.body) {
      lines.push(`    Body: ${content.body.slice(0, 100)}...`);
    }
    if (content.items?.length) {
      const itemTitles = content.items.slice(0, 3).map(i => i.title || i.text || '').join(', ');
      lines.push(`    Items: ${itemTitles}`);
    }
  });

  lines.push('');
  lines.push('Analyze this presentation and identify consolidation opportunities.');

  return lines.join('\n');
}

/**
 * Validate and normalize compression output
 */
function normalizeCompressionOutput(parsed, slideCount) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Compression analysis did not return valid JSON');
  }

  const output = {
    merges: [],
    removals: [],
    summary: parsed.summary || 'No changes recommended',
    originalCount: slideCount,
    recommendedCount: slideCount,
  };

  // Normalize merges
  if (Array.isArray(parsed.merges)) {
    for (const merge of parsed.merges) {
      const indexes = Array.isArray(merge?.slideIndexes) ? merge.slideIndexes : [];
      const validIndexes = indexes.filter(i => typeof i === 'number' && i >= 0 && i < slideCount);

      if (validIndexes.length >= 2) {
        output.merges.push({
          slideIndexes: validIndexes,
          reason: String(merge?.reason || 'Similar content'),
          mergedTitle: String(merge?.mergedTitle || ''),
        });
      }
    }
  }

  // Normalize removals
  if (Array.isArray(parsed.removals)) {
    for (const removal of parsed.removals) {
      const idx = removal?.slideIndex;
      if (typeof idx === 'number' && idx >= 0 && idx < slideCount) {
        output.removals.push({
          slideIndex: idx,
          reason: String(removal?.reason || 'Redundant'),
        });
      }
    }
  }

  // Calculate recommended count
  const uniqueMergeSlides = new Set(output.merges.flatMap(m => m.slideIndexes));
  const removalSlides = new Set(output.removals.map(r => r.slideIndex));
  const mergeReduction = uniqueMergeSlides.size - output.merges.length; // Each merge removes N-1 slides
  const removalReduction = [...removalSlides].filter(i => !uniqueMergeSlides.has(i)).length;

  output.recommendedCount = Math.max(1, slideCount - mergeReduction - removalReduction);

  return output;
}

/**
 * Analyze a presentation for compression opportunities
 *
 * @param {Object} presentation - The presentation to analyze
 * @param {Object} options
 * @param {string} options.targetReduction - 'moderate' or 'aggressive'
 * @param {string} options.vendor - LLM vendor override
 * @returns {Promise<Object>} Compression recommendations
 */
export async function analyzeForCompression(presentation, {
  targetReduction = 'moderate',
  vendor = null,
} = {}) {
  const startTime = Date.now();
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];
  const title = presentation?.title || 'Untitled Presentation';

  if (slides.length < 3) {
    return {
      merges: [],
      removals: [],
      summary: 'Presentation is already minimal (less than 3 slides)',
      originalCount: slides.length,
      recommendedCount: slides.length,
      durationMs: 0,
    };
  }

  const systemPrompt = buildCompressionSystemPrompt({ targetReduction });
  const userPrompt = buildCompressionUserPrompt({ title, slides });

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
    maxTokens: 4096,
    messages,
  });

  const parsed = extractJsonObject(rawResponse);
  if (!parsed) {
    throw LlmError.fromJsonParseFailure(rawResponse, {
      phase: 'compress',
      vendor: resolvedVendor,
      model,
    });
  }

  const result = normalizeCompressionOutput(parsed, slides.length);
  result.durationMs = Date.now() - startTime;
  result.vendor = resolvedVendor;
  result.model = model;

  console.log(`[Compress] Analyzed ${slides.length} slides: ${result.summary}`);

  return result;
}

/**
 * Apply compression recommendations to a presentation
 * Returns a new presentation with merged/removed slides
 *
 * @param {Object} presentation - The original presentation
 * @param {Object} recommendations - Output from analyzeForCompression
 * @returns {Object} New presentation with changes applied
 */
export function applyCompression(presentation, recommendations) {
  const slides = [...(presentation?.slides || [])];
  const { merges = [], removals = [] } = recommendations;

  // Track which slides to remove
  const toRemove = new Set(removals.map(r => r.slideIndex));

  // Track which slides are part of merges (except the first one which becomes the merged slide)
  for (const merge of merges) {
    const [, ...removeIdxs] = merge.slideIndexes;
    for (const idx of removeIdxs) {
      toRemove.add(idx);
    }
  }

  // Build new slides array, skipping removed slides
  const newSlides = slides.filter((_, idx) => !toRemove.has(idx));

  return {
    ...presentation,
    slides: newSlides,
    _compressionApplied: {
      originalCount: slides.length,
      newCount: newSlides.length,
      mergesApplied: merges.length,
      removalsApplied: toRemove.size - merges.reduce((sum, m) => sum + m.slideIndexes.length - 1, 0),
    },
  };
}
