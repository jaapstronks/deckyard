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
 * Build the system prompt for Phase 1
 */
function buildPhase1SystemPrompt({ detectedLang, requestedLang, targetSlides, estimatedInputLines }) {
  const langLabel = requestedLang === 'nl' ? 'DUTCH' : requestedLang === 'en-GB' ? 'ENGLISH' : detectedLang.label;

  return `You are a presentation outline generator. Analyze raw content and create a structured outline.

CRITICAL: Your role is to DISTILL and PRIORITIZE content. A good presentation is the 20% of source material that conveys 80% of the value. Each slide must earn its place. Push supporting detail and context to presenter notes, not onto slides.

OUTPUT LANGUAGE: ${langLabel}

Return ONLY valid JSON:
{
  "title": "Presentation Title",
  "subtitle": "Subtitle or speaker name",
  "summary": "2-3 sentence summary of the presentation's main theme",
  "statusMessages": ["Slide toevoegen over X...", "Hoofdstuk maken..."],
  "slides": [
    {
      "intent": "chapter|content|quote|closing",
      "roughContent": "Concise slide content (what appears on slide)",
      "presenterNotes": "Detailed context, examples, talking points for the presenter",
      "hints": ["hint1"],
      "groupId": "group-1"
    }
  ]
}

═══════════════════════════════════════════════════════════════════════════════
TITLE AND SUBTITLE - KEEP THEM SHORT!
═══════════════════════════════════════════════════════════════════════════════

The "title" and "subtitle" are for the TITLE SLIDE. They must be SHORT and punchy.

TITLE RULES:
- Maximum 6-8 words. Shorter is better.
- Just the core topic name, NOT a summary or description
- NO explanatory phrases like "in the Netherlands" or "programme running until 2029"
- Think: what would fit on a conference badge?

SUBTITLE RULES:
- Maximum 8-10 words. Can be empty if not needed.
- ONLY contextual info: event name, date, or speaker name
- NO additional topic information or qualifiers
- NO pipes (|) or concatenated phrases

BAD EXAMPLES:
- Title: "Annual Conference for Digital Innovation in Technology and Business"
- Subtitle: "Presented at Tech Summit — March 10–12, 2026"

GOOD EXAMPLES:
- Title: "Digital Innovation" or "Tech Summit 2026"
- Subtitle: "Tech Summit — March 2026" or "Jane Smith, Company"

When the source file has an event/date title (e.g., "Tech Summit 2026 – March 10–12"):
- That's CONTEXT, not the topic. Put it in the subtitle.
- Analyze the content to find the actual topic for the title.

═══════════════════════════════════════════════════════════════════════════════
IMPORTANT: NO OPENING/TITLE SLIDE
═══════════════════════════════════════════════════════════════════════════════

The presentation ALREADY has a title slide. Do NOT create an intent:"opening" slide.
Just fill in the "title" and "subtitle" fields at the top level.
Your slides array should start with either a "chapter" or "content" slide.

═══════════════════════════════════════════════════════════════════════════════
STATUS MESSAGES - META/PROCESS FOCUSED
═══════════════════════════════════════════════════════════════════════════════

Status messages describe the PROCESS of creating slides, not the content itself.

BAD (too content-focused):
  "Talentontwikkeling positioneren als groeiversneller voor de sector."
  "Digitale kanalen inventariseren: website, Circle-community, nieuwsbrief"

GOOD (process-focused):
  "Slide toevoegen over talentontwikkeling..."
  "Hoofdstuk maken over digitale strategie..."
  "Tijdlijn opbouwen met mijlpalen..."
  "Overzicht maken van de actielijnen..."
  "Quote toevoegen..."
  "Afrondende slide maken..."

In English:
  "Adding slide about talent development..."
  "Creating chapter on digital strategy..."
  "Building timeline with milestones..."
  "Creating overview of action lines..."
  "Adding quote..."
  "Creating closing slide..."

═══════════════════════════════════════════════════════════════════════════════
SLIDE INTENTS (no "opening" - that's automatic)
═══════════════════════════════════════════════════════════════════════════════

"chapter" - Section divider. Provide:
  - roughContent: "Chapter Title\\nOptional subtitle"
  - These are resolved directly, not sent to AI refinement

"content" - Regular content slide. Provide:
  - roughContent: RICH detail (4-8 bullet points, specifics, context)
  - hints: patterns detected (has-4-items, is-timeline, has-cause-effect, etc.)
  - groupId: group similar slides together

"quote" - Standalone quote. Provide:
  - roughContent: "The quote text.\\nAuthor Name\\nAuthor Role/Title"
  - Keep quotes short (1-3 sentences, max 260 chars)
  - These are resolved directly, not sent to AI refinement

"closing" - Final payoff slide (optional). Provide:
  - roughContent: "Optional tagline or call-to-action"
  - This is resolved directly, not sent to AI refinement

═══════════════════════════════════════════════════════════════════════════════
roughContent RULES
═══════════════════════════════════════════════════════════════════════════════

For CONTENT slides, be CONCISE but specific:
- 4-8 bullet points per slide (focused, not exhaustive)
- Include key specifics (numbers, names) but not every detail
- Put expanded detail in presenterNotes, not on the slide
- Each slide should stand alone with one clear message

BAD (too verbose, belongs in notes): "Educational institutions and investment rules with all details:\\n- Can invest in facilities for non-economic activities\\n- Must maintain separate accounting per activity type\\n- Public funds restricted to non-economic only\\n- Important distinction between support vs public funding\\n- November 17 adjustments clarified many rules\\n- Special provisions for research institutions\\n- EU state aid rules also apply"

GOOD (slide content):
roughContent: "Investment rules for educational institutions:\\n- Separate accounting required\\n- Public funds: non-economic activities only\\n- November 17 clarifications apply"
presenterNotes: "Key detail: institutions can invest in facilities but must maintain separate accounts. The Nov 17 adjustments clarified the distinction between support and public funding. Mention EU state aid rules if audience asks."

═══════════════════════════════════════════════════════════════════════════════
HINTS (for content slides only)
═══════════════════════════════════════════════════════════════════════════════

- "has-N-items" (e.g., "has-4-items") - parallel points
- "is-timeline" - sequential phases with dates
- "is-list-with-explanations" - items with title + description
- "has-numeric-data" - statistics, KPIs
- "has-cause-effect" - inputs→outputs, challenges→solutions (only when one group genuinely LEADS TO the other; plain parallel points are "has-N-items", not this)
- "has-comparison" - pros/cons, A vs B, before/after
- "has-matrix" - 2x2 grid like SWOT analysis
- "has-pyramid" - hierarchical levels, priority tiers
- "has-funnel" - narrowing stages with decreasing numbers
- "has-cycle" - recurring/circular process (PDCA, sprints)
- "has-process" - linear step-by-step workflow
- "has-history" - historical events with past dates

═══════════════════════════════════════════════════════════════════════════════
SLIDE BUDGET
═══════════════════════════════════════════════════════════════════════════════

Target: ${targetSlides} content slides (excluding title, chapter dividers, and closing)

Content density guidelines:
- Each content slide should cover ONE clear point
- Combine related items rather than creating multiple similar slides
- If two slides would have overlapping content, merge them
- Repetition is worse than omission

For input of ~${estimatedInputLines} lines:
- Aim for roughly 1 slide per 5-10 lines of distinct content
- Sections with overlap should share slides, not duplicate them

═══════════════════════════════════════════════════════════════════════════════
PRESENTER NOTES
═══════════════════════════════════════════════════════════════════════════════

For each content slide, generate "presenterNotes" with:
- Additional context and background not shown on slide
- Specific examples, data points, or anecdotes to mention
- Talking points and transitions to the next slide
- Answers to likely audience questions

The slide shows the WHAT. Notes contain the WHY and HOW.
Notes should be 2-4 sentences per slide.

═══════════════════════════════════════════════════════════════════════════════
STRUCTURE GUIDELINES
═══════════════════════════════════════════════════════════════════════════════

1. Start with a chapter or content slide (NOT opening)
2. Use chapters ONLY for major sections (prefer fewer chapters)
3. Give each chapter 3-5 content slides. A chapter divider carries no content
   of its own, so a deck that changes chapter every second slide spends a large
   share of its length on dividers. As a guide: under 10 content slides, use at
   most 2 chapters; only a long deck needs more than 4.
4. Stay within the slide budget (target: ${targetSlides} content slides)
5. Space quote slides apart (never back-to-back)
6. Consolidation is better than expansion - fewer strong slides beat many weak ones

═══════════════════════════════════════════════════════════════════════════════
REMINDER: OUTPUT LANGUAGE
═══════════════════════════════════════════════════════════════════════════════

All output text (title, subtitle, summary, statusMessages, roughContent, presenterNotes) MUST be in ${langLabel}.`;
}

/**
 * Build the user prompt for Phase 1
 */
function buildPhase1UserPrompt({ rawContent, userName, rawFirstSlideTitle }) {
  const lines = [
    'Analyze this content and create a presentation outline.',
    '',
  ];

  if (rawFirstSlideTitle) {
    lines.push(`ORIGINAL TITLE FROM SOURCE FILE: "${rawFirstSlideTitle}"`);
    lines.push('Note: This may be an event name, date, or contextual title rather than the actual topic.');
    lines.push('Determine the real presentation topic from the content and use that as the title.');
    lines.push('You may use the original title info in the subtitle if appropriate.');
    lines.push('');
  }

  if (userName) {
    lines.push(`PRESENTER NAME (use as subtitle on title slide): ${userName}`);
    lines.push('');
  }

  lines.push('RAW CONTENT:');
  lines.push(String(rawContent || ''));

  return lines.join('\n');
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

  const systemPrompt = buildPhase1SystemPrompt({
    detectedLang,
    requestedLang,
    targetSlides,
    estimatedInputLines,
  });

  const userPrompt = buildPhase1UserPrompt({
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