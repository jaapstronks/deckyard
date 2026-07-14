/**
 * AI-powered presentation analysis
 *
 * Analyzes existing presentations and provides improvement suggestions
 * via the comments system. Suggestions can include actionable slide additions.
 */

import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent, LlmError } from '../llm/index.js';
import { extractJsonObject } from '../openai/json.js';
import { SLIDE_TYPE_CATALOG } from './slide-type-catalog.js';

// Import default AI identity from shared constants (used as fallback)
import { DEFAULT_AI_EMAIL, DEFAULT_AI_NAME, DREAMBOT_EMAIL, DREAMBOT_NAME } from '../../../shared/constants/ai.js';
// Re-export for backward compatibility
export { DREAMBOT_EMAIL, DREAMBOT_NAME };
// Also export the defaults for use with getAiIdentity()
export { DEFAULT_AI_EMAIL, DEFAULT_AI_NAME };

// Suggestion categories
export const SUGGESTION_CATEGORIES = [
  'language',      // Improved wording, clarity, grammar
  'slide-type',    // Better slide type recommendation
  'visual-balance', // Too text-heavy, suggest images
  'structure',     // Chapter organization suggestions
  'tone',          // Inconsistent voice/style
  'spelling',      // Typos and grammatical errors
  'brevity',       // Opportunities to shorten
  'logic',         // Ordering or argument issues
  'repetition',    // Duplicate content detected
];

/**
 * Build the system prompt for presentation analysis
 */
function buildAnalysisSystemPrompt({ language }) {
  const langLabel = language === 'nl' ? 'DUTCH' : 'ENGLISH';

  // Build slide type catalog excerpt for the prompt
  const slideTypeInfo = Object.entries(SLIDE_TYPE_CATALOG)
    .filter(([_, def]) => !def.resolveInPhase1)
    .map(([type, def]) => {
      const bestFor = def.bestFor?.slice(0, 3).join(', ') || '';
      return `- ${type}: ${bestFor}`;
    })
    .join('\n');

  return `You are an AI assistant that reviews presentations and provides helpful improvement suggestions.

OUTPUT LANGUAGE: ${langLabel}
Write all suggestion text in ${langLabel}.

## YOUR ROLE

You analyze existing presentation slides and provide constructive feedback through two types of suggestions:

1. ADVISORY SUGGESTIONS - Text-only feedback
   - Language improvements, tone issues, spelling errors
   - Output: { body: "suggestion text", proposedSlide: null }

2. ACTIONABLE SUGGESTIONS - Include ready-to-add slide JSON
   - Slide type changes, new chapter dividers, content splits
   - Output: { body: "suggestion text", proposedSlide: { type: "...", content: {...} } }

## SUGGESTION CATEGORIES

Use these categories in your output:
- "language": Improved wording, clarity, grammar
- "slide-type": Better slide type recommendation (usually actionable)
- "visual-balance": Too text-heavy, suggest images
- "structure": Chapter organization suggestions (often actionable)
- "tone": Inconsistent voice/style
- "spelling": Typos and grammatical errors
- "brevity": Opportunities to shorten
- "logic": Ordering or argument issues
- "repetition": Duplicate content detected

## WHEN TO INCLUDE proposedSlide

Include proposedSlide JSON when suggesting:
- A different slide type for existing content (category: "slide-type")
- Adding a chapter-title-slide divider (category: "structure")
- Adding an image-slide for visual balance (category: "visual-balance")
- Splitting dense content into a new slide (category: "brevity")

## AVAILABLE SLIDE TYPES FOR ACTIONABLE SUGGESTIONS

${slideTypeInfo}

## OUTPUT FORMAT

Return ONLY valid JSON:
{
  "suggestions": [
    {
      "slideId": "uuid-from-input",
      "slideIndex": 3,
      "category": "slide-type",
      "body": "This list of 4 items with descriptions would work better as an icon-card-grid-slide...",
      "proposedSlide": {
        "type": "icon-card-grid-slide",
        "content": {
          "title": "Our Four Pillars",
          "cardCount": "4",
          "card1Icon": "lightbulb",
          "card1Title": "Innovation",
          "card1Body": "Driving creative solutions",
          "card2Icon": "users",
          "card2Title": "Collaboration",
          "card2Body": "Working together effectively",
          "card3Icon": "target",
          "card3Title": "Focus",
          "card3Body": "Staying on track",
          "card4Icon": "rocket-launch",
          "card4Title": "Growth",
          "card4Body": "Scaling our impact"
        }
      }
    },
    {
      "slideId": "uuid-from-input",
      "slideIndex": 5,
      "category": "spelling",
      "body": "Typo: 'recieve' should be 'receive'",
      "proposedSlide": null
    }
  ]
}

## GUIDELINES

1. Be constructive and specific - explain WHY a change would help
2. Focus on the most impactful suggestions (max 10 per presentation)
3. For actionable suggestions, ensure proposedSlide JSON is complete and valid
4. Don't suggest changes to title-slide or payoff-slide types (they're intentional)
5. When suggesting chapter dividers, place them at logical content transitions
6. For slide-type suggestions, transform the EXISTING content into the new format
7. Keep suggestion body text concise (1-3 sentences)

## ICON OPTIONS FOR icon-card-grid-slide

When creating icon-card-grid-slide content, use these icons:
user, users, users-three, handshake, link, arrow-right, arrow-up, trend-up, chart-line-up,
file-text, clipboard-text, lightbulb, target, rocket-launch, gear, shield-check, check-circle,
warning-circle, calendar, globe, heart, star`;
}

/**
 * Build the user prompt with presentation content
 */
function buildAnalysisUserPrompt({ slides, categories }) {
  const slidesJson = slides.map((slide, idx) => ({
    index: idx,
    id: slide.id,
    type: slide.type,
    content: slide.content,
  }));

  const lines = [
    'Analyze this presentation and provide improvement suggestions.',
    '',
  ];

  if (categories && categories.length > 0) {
    lines.push(`Focus on these categories: ${categories.join(', ')}`);
    lines.push('');
  }

  lines.push('PRESENTATION SLIDES:');
  lines.push(JSON.stringify(slidesJson, null, 2));

  return lines.join('\n');
}

/**
 * Validate and normalize analysis output
 */
function normalizeAnalysisOutput(parsed, slides) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Analysis did not return valid JSON');
  }

  const suggestions = [];
  const slideIdSet = new Set(slides.map(s => s.id));

  if (Array.isArray(parsed.suggestions)) {
    for (const sug of parsed.suggestions) {
      // Validate slideId exists
      const slideId = sug?.slideId;
      if (!slideId || !slideIdSet.has(slideId)) {
        continue; // Skip invalid suggestions
      }

      // Validate category
      const category = sug?.category;
      if (!SUGGESTION_CATEGORIES.includes(category)) {
        continue;
      }

      // Validate body
      const body = String(sug?.body || '').trim();
      if (!body) {
        continue;
      }

      // Validate proposedSlide if present
      let proposedSlide = null;
      if (sug?.proposedSlide && typeof sug.proposedSlide === 'object') {
        const { type, content } = sug.proposedSlide;
        if (type && SLIDE_TYPE_CATALOG[type] && content) {
          proposedSlide = { type, content };
        }
      }

      suggestions.push({
        slideId,
        slideIndex: typeof sug?.slideIndex === 'number' ? sug.slideIndex : null,
        category,
        body,
        proposedSlide,
      });
    }
  }

  return { suggestions };
}

/**
 * Analyze a presentation and generate improvement suggestions
 *
 * @param {Object} presentation - The presentation object with slides
 * @param {Object} options
 * @param {string[]} options.categories - Filter to specific suggestion categories
 * @param {string} options.vendor - LLM vendor override
 * @param {Function} options.onProgress - Callback for progress updates
 * @returns {Promise<Object>} Analysis results with suggestions
 */
export async function analyzePresentation(presentation, {
  categories = null,
  vendor = null,
  onProgress = null,
} = {}) {
  const startTime = Date.now();
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  // Get slides from presentation
  const slides = presentation?.slides || [];
  if (slides.length === 0) {
    return { suggestions: [], metadata: { slideCount: 0 } };
  }

  // Detect language from first few slides
  const sampleText = slides.slice(0, 5)
    .map(s => `${s.content?.title || ''} ${s.content?.body || ''}`)
    .join(' ');
  const language = /[àáâãäåæçèéêëìíîïñòóôõöùúûü]/i.test(sampleText) ||
    /\b(de|het|een|en|van|voor|met|zijn|worden)\b/i.test(sampleText)
    ? 'nl' : 'en';

  if (onProgress) {
    onProgress({ phase: 'analyzing', slideCount: slides.length });
  }

  const systemPrompt = buildAnalysisSystemPrompt({ language });
  const userPrompt = buildAnalysisUserPrompt({
    slides,
    categories: categories && categories.length > 0 ? categories : null,
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
    maxTokens: 8192,
    messages,
  });

  if (onProgress) {
    onProgress({ phase: 'parsing' });
  }

  const parsed = extractJsonObject(rawResponse);
  if (!parsed) {
    throw LlmError.fromJsonParseFailure(rawResponse, {
      phase: 'analyze',
      vendor: resolvedVendor,
      model,
    });
  }

  const output = normalizeAnalysisOutput(parsed, slides);

  output.metadata = {
    slideCount: slides.length,
    suggestionCount: output.suggestions.length,
    language,
    vendor: resolvedVendor,
    model,
    durationMs: Date.now() - startTime,
  };

  if (onProgress) {
    onProgress({ phase: 'complete', suggestionCount: output.suggestions.length });
  }

  return output;
}

/**
 * Convert a suggestion to comment data.
 * @param {Object} suggestion - The suggestion object from AI analysis
 * @param {string} presentationId - Presentation ID
 * @param {Object} [aiIdentity] - Optional custom AI identity { email, name }
 * @returns {Object} Comment data object
 */
export function suggestionToCommentData(suggestion, presentationId, aiIdentity = null) {
  return {
    presentationId,
    slideId: suggestion.slideId,
    email: aiIdentity?.email || DREAMBOT_EMAIL,
    name: aiIdentity?.name || DREAMBOT_NAME,
    body: suggestion.body,
    commentType: 'ai-suggestion',
    suggestionCategory: suggestion.category,
    proposedSlide: suggestion.proposedSlide,
  };
}