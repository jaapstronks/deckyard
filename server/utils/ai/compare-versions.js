/**
 * AI-powered version comparison
 *
 * Generates human-readable summaries of differences between presentation versions.
 */

import { getLlmConfig, detectDefaultVendor } from '../llm/config.js';
import { requestChatCompletionContent, LlmError } from '../llm/index.js';
import { extractJsonObject } from '../openai/json.js';

/**
 * Check if AI comparison is available (LLM is configured).
 * @returns {boolean}
 */
export function isAiCompareAvailable() {
  return detectDefaultVendor() !== null;
}

/**
 * Build the system prompt for version comparison.
 */
function buildCompareSystemPrompt({ language }) {
  const langLabel = language === 'nl' ? 'DUTCH' : 'ENGLISH';

  return `You are an AI assistant that analyzes differences between presentation versions.

OUTPUT LANGUAGE: ${langLabel}
Write all insight text in ${langLabel}.

## YOUR ROLE

You analyze specific changes between two versions of a presentation and provide per-slide insights.
Focus on meaningful content changes that help the user understand what changed and why it matters.

## OUTPUT FORMAT

Return ONLY valid JSON with per-slide insights:
{
  "insights": [
    {
      "slideId": "uuid-of-the-slide",
      "category": "added|removed|modified",
      "comment": "Brief explanation of the change (1-2 sentences)"
    }
  ]
}

## GUIDELINES

1. Only include insights for slides that have meaningful changes (added, removed, or modified)
2. Do NOT include insights for unchanged slides
3. For each changed slide, explain:
   - ADDED: What this new slide contributes to the presentation
   - REMOVED: What content was lost and why it might matter
   - MODIFIED: What specifically changed (title, content, structure)
4. Keep comments concise (1-2 sentences max)
5. Focus on content meaning, not technical details
6. Reference slide titles when helpful for context

## EXAMPLES

For an added slide:
{ "slideId": "abc-123", "category": "added", "comment": "New slide introducing the Q4 roadmap - this content wasn't in the previous version." }

For a removed slide:
{ "slideId": "def-456", "category": "removed", "comment": "The competitive analysis section was removed. Consider if this information is still needed." }

For a modified slide:
{ "slideId": "ghi-789", "category": "modified", "comment": "The revenue projections were updated from $2M to $2.5M, and a new chart was added." }`;
}

/**
 * Summarize slide content for the prompt.
 */
function summarizeSlideContent(slide) {
  const parts = [];
  if (slide.content?.title) parts.push(`Title: "${slide.content.title}"`);
  if (slide.content?.subtitle) parts.push(`Subtitle: "${slide.content.subtitle}"`);
  if (slide.content?.body) {
    const body = String(slide.content.body).slice(0, 200);
    parts.push(`Body: "${body}${slide.content.body.length > 200 ? '...' : ''}"`);
  }
  if (slide.content?.items) {
    const items = Array.isArray(slide.content.items) ? slide.content.items : [];
    parts.push(`Items: ${items.length} bullet points`);
  }
  return parts.join(', ') || `(${slide.type} slide)`;
}

/**
 * Build the user prompt with version data.
 */
function buildCompareUserPrompt({ currentSlides, snapshotSlides, snapshotDate, diff }) {
  const lines = [`Analyze the differences between these presentation versions:\n`];

  // Added slides (in current only)
  if (diff.added.length > 0) {
    lines.push('## ADDED SLIDES (new in current version):');
    for (const { slide } of diff.added) {
      lines.push(`- ID: ${slide.id}`);
      lines.push(`  Type: ${slide.type}`);
      lines.push(`  Content: ${summarizeSlideContent(slide)}`);
    }
    lines.push('');
  }

  // Removed slides (in snapshot only)
  if (diff.removed.length > 0) {
    lines.push('## REMOVED SLIDES (were in snapshot, not in current):');
    for (const { slide } of diff.removed) {
      lines.push(`- ID: ${slide.id}`);
      lines.push(`  Type: ${slide.type}`);
      lines.push(`  Content: ${summarizeSlideContent(slide)}`);
    }
    lines.push('');
  }

  // Modified slides
  if (diff.modified.length > 0) {
    lines.push('## MODIFIED SLIDES (changed between versions):');
    for (const { current, snapshot } of diff.modified) {
      lines.push(`- ID: ${current.id}`);
      lines.push(`  Type: ${current.type}`);
      lines.push(`  BEFORE: ${summarizeSlideContent(snapshot)}`);
      lines.push(`  AFTER: ${summarizeSlideContent(current)}`);
    }
    lines.push('');
  }

  lines.push(`Snapshot date: ${snapshotDate}`);
  lines.push(`Total: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.modified.length} modified, ${diff.unchanged.length} unchanged`);
  lines.push('\nProvide insights for each changed slide using the exact slide IDs shown above.');

  return lines.join('\n');
}

/**
 * Detect language from slide content.
 */
function detectLanguage(slides) {
  const sampleText = slides
    .slice(0, 5)
    .map((s) => `${s.content?.title || ''} ${s.content?.body || ''}`)
    .join(' ');

  const isDutch =
    /[àáâãäåæçèéêëìíîïñòóôõöùúûü]/i.test(sampleText) ||
    /\b(de|het|een|en|van|voor|met|zijn|worden)\b/i.test(sampleText);

  return isDutch ? 'nl' : 'en';
}

/**
 * Compute a simple diff between slide arrays.
 * @param {Array} currentSlides
 * @param {Array} snapshotSlides
 * @returns {Object} Diff result
 */
function computeSimpleDiff(currentSlides, snapshotSlides) {
  const currentById = new Map(currentSlides.map((s) => [s.id, s]));
  const snapshotById = new Map(snapshotSlides.map((s) => [s.id, s]));

  const added = [];
  const removed = [];
  const modified = [];
  const unchanged = [];

  // Check current slides
  for (const slide of currentSlides) {
    if (!snapshotById.has(slide.id)) {
      added.push({ slide });
    } else {
      const snapshotSlide = snapshotById.get(slide.id);
      const currentHash = JSON.stringify(slide.content || {});
      const snapshotHash = JSON.stringify(snapshotSlide.content || {});
      if (currentHash !== snapshotHash) {
        modified.push({ current: slide, snapshot: snapshotSlide });
      } else {
        unchanged.push({ slide });
      }
    }
  }

  // Find removed slides
  for (const slide of snapshotSlides) {
    if (!currentById.has(slide.id)) {
      removed.push({ slide });
    }
  }

  return {
    added,
    removed,
    modified,
    unchanged,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      unchangedCount: unchanged.length,
    },
  };
}

/**
 * Generate AI-powered per-slide insights comparing two presentation versions.
 *
 * @param {Object} options
 * @param {Array} options.currentSlides - Current presentation slides
 * @param {Array} options.snapshotSlides - Snapshot slides to compare against
 * @param {string} options.snapshotDate - Human-readable date of the snapshot
 * @param {string} options.vendor - LLM vendor override
 * @returns {Promise<Object>} { insights: [{slideId, category, comment}], metadata }
 */
export async function compareVersionsWithAi({
  currentSlides,
  snapshotSlides,
  snapshotDate,
  vendor = null,
} = {}) {
  const startTime = Date.now();

  // Get LLM config
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  // Compute diff
  const diff = computeSimpleDiff(currentSlides, snapshotSlides);

  // Quick exit if no changes
  if (
    diff.summary.addedCount === 0 &&
    diff.summary.removedCount === 0 &&
    diff.summary.modifiedCount === 0
  ) {
    return {
      insights: [],
      metadata: {
        vendor: resolvedVendor,
        model,
        durationMs: Date.now() - startTime,
        ...diff.summary,
      },
    };
  }

  // Detect language
  const language = detectLanguage([...currentSlides, ...snapshotSlides]);

  // Build prompts
  const systemPrompt = buildCompareSystemPrompt({ language });
  const userPrompt = buildCompareUserPrompt({
    currentSlides,
    snapshotSlides,
    snapshotDate,
    diff,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // Request completion
  const rawResponse = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.3,
    responseFormat: { type: 'json_object' },
    maxTokens: 2048,
    messages,
  });

  // Parse response
  const parsed = extractJsonObject(rawResponse);
  if (!parsed || !Array.isArray(parsed.insights)) {
    throw LlmError.fromJsonParseFailure(rawResponse, {
      phase: 'compare-versions',
      vendor: resolvedVendor,
      model,
    });
  }

  // Validate and normalize insights
  const validSlideIds = new Set([
    ...currentSlides.map((s) => s.id),
    ...snapshotSlides.map((s) => s.id),
  ]);

  const insights = parsed.insights
    .filter((i) => i && typeof i === 'object')
    .filter((i) => validSlideIds.has(i.slideId))
    .filter((i) => ['added', 'removed', 'modified'].includes(i.category))
    .filter((i) => typeof i.comment === 'string' && i.comment.trim())
    .map((i) => ({
      slideId: i.slideId,
      category: i.category,
      comment: i.comment.trim(),
    }));

  return {
    insights,
    metadata: {
      vendor: resolvedVendor,
      model,
      durationMs: Date.now() - startTime,
      language,
      ...diff.summary,
    },
  };
}
