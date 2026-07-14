/**
 * Phase 2: Slide Refinement
 *
 * Takes rough slides from Phase 1 and converts them to specific slide types
 * with fully structured content.
 *
 * Key features:
 * - Processes slides in groups (1-4 slides per call) for consistency
 * - Has full knowledge of slide type catalog
 * - Includes reasoning/deliberation in output for debugging
 * - Considers adjacent slide context to avoid repetition
 */

import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent, LlmError } from '../llm/index.js';
import { extractJsonObject } from '../openai/json.js';
import { buildPhase2CatalogPrompt, SLIDE_TYPE_CATALOG } from './slide-type-catalog.js';
import { validateSlideContentStructure } from './validate-slide-structure.js';
import { validateSlideContent } from './schemas/index.js';

/**
 * Build the system prompt for Phase 2 refinement
 */
function buildPhase2SystemPrompt({ lang, adjacentContext, presentationContext, disabledSlideTypes, customSlideTypes, themeContext }) {
  const langLabel = lang === 'nl' ? 'DUTCH' : 'ENGLISH';
  const catalogPrompt = buildPhase2CatalogPrompt({ disabledSlideTypes, customSlideTypes });

  let contextSection = '';
  if (presentationContext?.title) {
    contextSection = `
═══════════════════════════════════════════════════════════════════════════════
PRESENTATION CONTEXT
═══════════════════════════════════════════════════════════════════════════════

Title: ${presentationContext.title}
${presentationContext.summary ? `Summary: ${presentationContext.summary}` : ''}

You are creating slides for this presentation. Keep content consistent with the theme.
`;
  }

  return `You are a slide type selector and content formatter.

YOUR JOB:
1. Choose the BEST slide type for each rough slide based on its content
2. Structure the content using the EXACT schema shown in the catalog (no mixing!)
3. Provide brief reasoning for debugging

OUTPUT LANGUAGE: ${langLabel}
Write all titles and content in ${langLabel}.
${contextSection}
═══════════════════════════════════════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════════════════════════════════════

1. ALL SLIDES HERE ARE intent:"content" - choose the best content slide type

2. USE EXACT SCHEMAS:
   - Each slide type has a specific content structure
   - Do NOT add fields that don't belong
   - Copy the structure from the examples exactly

3. PREFER SPECIALIZED SLIDES — BUT ONLY WHEN THEY GENUINELY FIT:
   - content-slide / list-slide are the right default for plain text and lists
   - Look for REAL structure in the content (lists, comparisons, timelines)
   - 4+ items with titles → list-slide or icon-card-grid-slide
   - GENUINE cause→effect / input→output between groups → text-blocks-slide
     (only when the arrow's implied causality is real; for parallel or plain
     points use list-slide instead)
   - Timeline/roadmap with dates → timeline-slide
   - When uncertain, choose the plainer type (text or bulleted list)

4. MAX LENGTHS (will be truncated if exceeded):
   - title: 120 chars
   - list-slide item title: 80 chars, item text: 120 chars
   - card labels: 40 chars
   - Keep content concise!

${adjacentContext ? `ADJACENT CONTEXT (avoid repetition):\n${adjacentContext}\n` : ''}

${catalogPrompt}

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

Return ONLY valid JSON:
{
  "slides": [
    {
      "originalIndex": <the exact index shown in the input>,
      "type": "<slide-type-name>",
      "content": { <exact schema for this type> },
      "reasoning": "Chose text-blocks because content has cause-effect structure",
      "alternativeType": "icon-card-grid-slide",
      "alternativeReason": "Use if items are independent rather than causal"
    }
  ]
}

CONTENT TIPS:
- list-slide: items[] array, minimum 2 items, each with {title, text}
- timeline-slide: items[] array, minimum 2, each with {date, title, text}
- icon-card-grid-slide: items[] array, each with {icon, title, body}
- text-blocks-slide: rows[] array (1-3), each row has {color, arrow, blocks[]}
- kpi-metrics-slide: metrics[] array (1-4), each with {value, unit, label, note}
- team-cards-slide: members[] array, each with {name, byline, image}
- logo-wall-slide: logos[] array, each with {name, image}

REMINDER: All slide content (titles, body text, etc.) MUST be written in ${langLabel}.${buildThemeContextSection(themeContext)}`;
}

/**
 * Build a theme context section for the system prompt.
 * Tells the AI about available backgrounds, brand colors, and slide background options.
 */
function buildThemeContextSection(themeContext) {
  if (!themeContext) return '';

  const parts = [];

  if (themeContext.backgroundOptions?.length) {
    parts.push(`Available slide backgrounds: ${themeContext.backgroundOptions.join(', ')}`);
    parts.push('When a slide type supports a "background" field, choose from these options.');
  }

  if (themeContext.brandColors?.length) {
    parts.push(`Brand accent colors: ${themeContext.brandColors.join(', ')}`);
  }

  if (themeContext.hasBackgroundImages) {
    parts.push('This theme has background image presets — image-slide and other image-capable types will look good.');
  }

  if (!parts.length) return '';

  return `

THEME CONTEXT:
${parts.join('\n')}`;
}

/**
 * Build the user prompt for Phase 2
 */
function buildPhase2UserPrompt({ slides, groupId }) {
  const lines = [
    `Refine ${slides.length === 1 ? 'this slide' : `these ${slides.length} slides`} into structured slide types.`,
    '',
  ];

  if (slides.length > 1) {
    lines.push(`GROUP ID: ${groupId}`);
    lines.push('These slides should have consistent styling where appropriate.');
    lines.push('');
  }

  // Use position (1-based for clarity) AND original index
  for (let pos = 0; pos < slides.length; pos++) {
    const slide = slides[pos];
    lines.push(`--- SLIDE #${pos + 1} (originalIndex: ${slide.index}) ---`);
    lines.push(`Intent: ${slide.intent}`);
    lines.push(`Hints: ${slide.hints.length ? slide.hints.join(', ') : 'none'}`);
    lines.push('Content:');
    lines.push(slide.roughContent);
    if (slide.presenterNotes) {
      lines.push('');
      lines.push('Presenter Notes (preserve for the slide):');
      lines.push(slide.presenterNotes);
    }
    lines.push('');
  }

  lines.push('IMPORTANT: For each slide in your response, set "originalIndex" to the exact number shown above (e.g., originalIndex: ' + slides[0].index + ' for the first slide).');

  return lines.join('\n');
}

/**
 * Map intent to allowed slide types
 * @param {string} intent
 * @param {Array} [disabledSlideTypes] - Org-level disabled types to exclude
 */
function getAllowedTypesForIntent(intent, disabledSlideTypes = []) {
  const disabled = new Set(Array.isArray(disabledSlideTypes) ? disabledSlideTypes : []);
  const filter = (types) => types.filter(t => !disabled.has(t));

  switch (intent) {
    case 'opening': {
      const result = filter(['title-slide']);
      return result.length ? result : ['title-slide'];
    }
    case 'chapter': {
      const result = filter(['chapter-title-slide']);
      return result.length ? result : ['chapter-title-slide'];
    }
    case 'quote': {
      const result = filter(['quote-slide']);
      return result.length ? result : ['quote-slide'];
    }
    case 'closing':
      return filter(['payoff-slide', 'content-slide']);
    case 'content':
    default:
      // All Phase 2 slide types (excluding org-disabled)
      return Object.entries(SLIDE_TYPE_CATALOG)
        .filter(([type, def]) => !def.resolveInPhase1 && !disabled.has(type))
        .map(([type]) => type);
  }
}

/**
 * Build context string about adjacent slides
 */
function buildAdjacentContext(slideGroup, allGroups, groupIndex) {
  const lines = [];

  // Previous group's slide types
  if (groupIndex > 0) {
    const prevGroup = allGroups[groupIndex - 1];
    if (prevGroup?.resolvedTypes?.length) {
      lines.push(`Previous slides: ${prevGroup.resolvedTypes.join(', ')}`);
    }
  }

  // Next group's hints (if known)
  if (groupIndex < allGroups.length - 1) {
    const nextGroup = allGroups[groupIndex + 1];
    if (nextGroup?.slides?.[0]?.hints?.length) {
      lines.push(`Next slide hints: ${nextGroup.slides[0].hints.slice(0, 3).join(', ')}`);
    }
  }

  return lines.length ? lines.join('\n') : '';
}

/**
 * Normalize and validate refined slide output
 */
function normalizeRefinedSlide(slide, originalSlide, disabledSlideTypes = []) {
  const allowedTypes = getAllowedTypesForIntent(originalSlide.intent, disabledSlideTypes);
  let type = String(slide?.type || 'content-slide').trim();
  const content = slide?.content || {};

  // Validate type is allowed for this intent
  if (!allowedTypes.includes(type)) {
    console.warn(`[Phase2] Type "${type}" not allowed for intent "${originalSlide.intent}", using fallback`, {
      originalIndex: originalSlide.index,
      requestedType: type,
      intent: originalSlide.intent,
      allowedTypes,
      fallbackTo: allowedTypes[0] || 'content-slide',
    });
    type = allowedTypes[0] || 'content-slide';
  }

  // Validate content structure matches the type (existing validation)
  const structureIssues = validateSlideContentStructure(type, content, originalSlide.index);
  if (structureIssues.length > 0) {
    console.warn(`[Phase2] Content structure issues for ${type}:`, {
      originalIndex: originalSlide.index,
      issues: structureIssues,
      contentKeys: Object.keys(content),
    });
  }

  // Zod schema validation (defense-in-depth, logs warnings but doesn't block)
  const zodResult = validateSlideContent(type, content);
  if (!zodResult.valid && zodResult.issues.length > 0) {
    console.warn(`[Phase2] Zod validation issues for ${type}:`, {
      originalIndex: originalSlide.index,
      issues: zodResult.issues,
    });
  }

  return {
    originalIndex: originalSlide.index,
    type,
    content,
    reasoning: String(slide?.reasoning || '').trim(),
    alternativeType: String(slide?.alternativeType || '').trim() || null,
    alternativeReason: String(slide?.alternativeReason || '').trim() || null,
    presenterNotes: originalSlide.presenterNotes || '',
  };
}

/**
 * Create a fallback slide when refinement fails
 */
function createFallbackSlide(originalSlide) {
  const intent = originalSlide.intent;
  const presenterNotes = originalSlide.presenterNotes || '';

  if (intent === 'opening') {
    const lines = originalSlide.roughContent.split('\n').filter(l => l.trim());
    return {
      originalIndex: originalSlide.index,
      type: 'title-slide',
      content: {
        title: lines[0] || 'Presentation',
        subheading: lines[1] || '',
        background: 'lime',
      },
      reasoning: 'Fallback: Phase 2 failed, created basic title slide',
      presenterNotes,
    };
  }

  if (intent === 'chapter') {
    const lines = originalSlide.roughContent.split('\n').filter(l => l.trim());
    return {
      originalIndex: originalSlide.index,
      type: 'chapter-title-slide',
      content: {
        title: lines[0] || 'Section',
        subtitle: lines[1] || '',
      },
      reasoning: 'Fallback: Phase 2 failed, created basic chapter slide',
      presenterNotes,
    };
  }

  if (intent === 'quote') {
    const content = originalSlide.roughContent;
    // Try to extract quote and author
    const quoteMatch = content.match(/"([^"]+)"/);
    const quote = quoteMatch ? quoteMatch[1] : content.slice(0, 260);

    return {
      originalIndex: originalSlide.index,
      type: 'quote-slide',
      content: {
        quote: quote.trim(),
        authorName: 'Unknown',
        authorTitle: '',
      },
      reasoning: 'Fallback: Phase 2 failed, created basic quote slide',
      presenterNotes,
    };
  }

  if (intent === 'closing') {
    return {
      originalIndex: originalSlide.index,
      type: 'payoff-slide',
      content: {
        tagline: originalSlide.roughContent.slice(0, 120).trim() || 'Thank you',
      },
      reasoning: 'Fallback: Phase 2 failed, created basic closing slide',
      presenterNotes,
    };
  }

  // Default: content slide
  return {
    originalIndex: originalSlide.index,
    type: 'content-slide',
    content: {
      title: 'Slide',
      body: originalSlide.roughContent,
      layout: 'one-column',
      background: 'lime',
    },
    reasoning: 'Fallback: Phase 2 failed, created basic content slide',
    presenterNotes,
  };
}

/**
 * Refine a group of slides
 *
 * @param {Object} slideGroup - Group of slides to refine
 * @param {Object} options
 * @param {string} options.lang - Output language ('nl' or 'en-GB')
 * @param {string} options.vendor - LLM vendor override
 * @param {string} options.adjacentContext - Context about adjacent slides
 * @param {Object} options.presentationContext - Title and summary of presentation
 * @param {Function} options.onLog - Callback to log the conversation
 * @returns {Promise<Array>} Refined slides
 */
export async function refineSlideGroup(slideGroup, {
  lang = 'en',
  vendor = null,
  adjacentContext = '',
  presentationContext = null,
  onLog = null,
  disabledSlideTypes = [],
  customSlideTypes = [],
  themeContext = null,
} = {}) {
  const startTime = Date.now();
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });
  const { slides, groupId } = slideGroup;

  const systemPrompt = buildPhase2SystemPrompt({
    lang,
    adjacentContext,
    presentationContext,
    disabledSlideTypes,
    customSlideTypes,
    themeContext,
  });

  const userPrompt = buildPhase2UserPrompt({
    slides,
    groupId,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let rawResponse;
  let parsed;
  let retryCount = 0;
  const maxRetries = 1;

  while (retryCount <= maxRetries) {
    try {
      rawResponse = await requestChatCompletionContent({
        vendor: resolvedVendor,
        apiKey,
        model,
        temperature: 0.3,
        responseFormat: { type: 'json_object' },
        // Headroom so slides come back fully populated (e.g. timeline items
        // with real descriptions) even when the model also spends output
        // tokens on thinking.
        maxTokens: 12000,
        messages,
      });

      parsed = extractJsonObject(rawResponse);

      if (parsed?.slides && Array.isArray(parsed.slides) && parsed.slides.length > 0) {
        break;
      }

      throw new Error('Invalid response structure');
    } catch (err) {
      retryCount++;
      if (retryCount > maxRetries) {
        console.error(`[Phase2] Failed after ${maxRetries + 1} attempts for group ${groupId}:`, err.message);

        // Return fallback slides
        const fallbackSlides = slides.map(s => createFallbackSlide(s));

        if (typeof onLog === 'function') {
          onLog({
            input: { slides, groupId },
            messages,
            output: { slides: fallbackSlides, error: err.message },
            rawResponse: String(rawResponse || '').slice(0, 5000),
            metadata: {
              vendor: resolvedVendor,
              model,
              durationMs: Date.now() - startTime,
              retries: retryCount,
              fallback: true,
            },
          });
        }

        return fallbackSlides;
      }

      console.warn(`[Phase2] Retry ${retryCount} for group ${groupId}`);
    }
  }

  // Normalize the output with robust index matching
  const refinedSlides = [];
  const slidesMap = new Map(slides.map(s => [s.index, s]));
  const usedOriginalIndexes = new Set();

  // First pass: match by originalIndex
  for (let pos = 0; pos < parsed.slides.length; pos++) {
    const refined = parsed.slides[pos];
    const idx = refined?.originalIndex;
    let originalSlide = slidesMap.get(idx);

    // If exact match not found, try position-based fallback
    if (!originalSlide && pos < slides.length) {
      originalSlide = slides[pos];
      console.warn(`[Phase2] Index ${idx} not found, using position-based fallback (actual index: ${originalSlide.index})`);
    }

    if (!originalSlide) {
      console.warn(`[Phase2] No original slide found for index ${idx}, position ${pos}`);
      continue;
    }

    // Skip if we already processed this original slide
    if (usedOriginalIndexes.has(originalSlide.index)) {
      console.warn(`[Phase2] Duplicate refined slide for index ${originalSlide.index}, skipping`);
      continue;
    }

    usedOriginalIndexes.add(originalSlide.index);
    refinedSlides.push(normalizeRefinedSlide(refined, originalSlide, disabledSlideTypes));
  }

  // Add any missing slides as fallbacks
  for (const original of slides) {
    if (!usedOriginalIndexes.has(original.index)) {
      console.warn(`[Phase2] Missing refined slide for index ${original.index}, using fallback`);
      refinedSlides.push(createFallbackSlide(original));
    }
  }

  // Sort by original index
  refinedSlides.sort((a, b) => a.originalIndex - b.originalIndex);

  // Log the conversation
  if (typeof onLog === 'function') {
    onLog({
      input: { slides, groupId },
      messages,
      output: { slides: refinedSlides },
      rawResponse,
      metadata: {
        vendor: resolvedVendor,
        model,
        durationMs: Date.now() - startTime,
        retries: retryCount,
        slideCount: refinedSlides.length,
      },
    });
  }

  return refinedSlides;
}

// Status messages to cycle through during Phase 2 refinement
const PHASE2_STATUS_MESSAGES_EN = [
  'Analyzing slide structure...',
  'Selecting best slide types...',
  'Formatting content...',
  'Applying layout templates...',
  'Optimizing text for readability...',
  'Structuring data visualizations...',
  'Refining slide composition...',
];

const PHASE2_STATUS_MESSAGES_NL = [
  'Slide-structuur analyseren...',
  'Beste slide types selecteren...',
  'Inhoud opmaken...',
  'Layout templates toepassen...',
  'Tekst optimaliseren voor leesbaarheid...',
  'Datavisualisaties structureren...',
  'Slide-compositie verfijnen...',
];

function getPhase2StatusMessages(lang) {
  return lang === 'nl' ? PHASE2_STATUS_MESSAGES_NL : PHASE2_STATUS_MESSAGES_EN;
}

/**
 * Refine all slide groups in parallel batches
 *
 * @param {Array} groups - Array of slide groups from groupSlidesForPhase2()
 * @param {Object} options
 * @param {string} options.lang
 * @param {string} options.vendor
 * @param {Function} options.onLog
 * @param {number} options.batchSize - Max parallel calls (default 6)
 * @param {Object} options.presentationContext - Title and summary of presentation
 * @param {Function} options.onStatusMessage - Callback for status messages
 * @param {Function} options.onGroupDone - ({ done, total }) => void, called as
 *   each section group finishes (real progress, for streaming UIs)
 * @returns {Promise<Array>} All refined slides in order
 */
export async function refineAllSlideGroups(groups, {
  lang = 'en',
  vendor = null,
  onLog = null,
  batchSize = 6,
  presentationContext = null,
  onStatusMessage = null,
  onGroupDone = null,
  disabledSlideTypes = [],
  customSlideTypes = [],
  themeContext = null,
} = {}) {
  const allRefinedSlides = [];
  let statusMessageIndex = 0;
  let statusInterval = null;
  const statusMessages = getPhase2StatusMessages(lang);

  // Send periodic status messages during processing
  if (typeof onStatusMessage === 'function' && groups.length > 0) {
    onStatusMessage(statusMessages[0]);
    statusMessageIndex = 1;

    // Send a new status message every 3 seconds
    statusInterval = setInterval(() => {
      if (statusMessageIndex < statusMessages.length) {
        onStatusMessage(statusMessages[statusMessageIndex]);
        statusMessageIndex++;
      } else {
        // Cycle back through messages if still processing
        statusMessageIndex = 0;
        onStatusMessage(statusMessages[statusMessageIndex]);
        statusMessageIndex++;
      }
    }, 3000);
  }

  let groupsDone = 0;

  try {
    // Process in batches
    for (let i = 0; i < groups.length; i += batchSize) {
      const batch = groups.slice(i, i + batchSize);

      const batchPromises = batch.map((group, batchIndex) => {
        const groupIndex = i + batchIndex;
        const adjacentContext = buildAdjacentContext(group, groups, groupIndex);

        return refineSlideGroup(group, {
          lang,
          vendor,
          adjacentContext,
          presentationContext,
          onLog,
          disabledSlideTypes,
          customSlideTypes,
          themeContext,
        }).then(refinedSlides => {
          // Track resolved types for adjacent context
          group.resolvedTypes = refinedSlides.map(s => s.type);
          // Real progress: one tick per finished section group.
          if (typeof onGroupDone === 'function') {
            groupsDone += 1;
            try {
              onGroupDone({ done: groupsDone, total: groups.length });
            } catch {
              // progress reporting must never break generation
            }
          }
          return refinedSlides;
        });
      });

      const batchResults = await Promise.all(batchPromises);

      for (const slides of batchResults) {
        allRefinedSlides.push(...slides);
      }
    }
  } finally {
    // Clear the status interval when done
    if (statusInterval) {
      clearInterval(statusInterval);
    }
  }

  // Sort all slides by original index
  allRefinedSlides.sort((a, b) => a.originalIndex - b.originalIndex);

  return allRefinedSlides;
}