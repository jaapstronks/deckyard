/**
 * Section refine: revise a contiguous range of slides in an existing deck
 * from user feedback. Used by the whole-deck review grid's multi-select
 * "Adjust section" action.
 *
 * The prompt sees the deck summary, a couple of neighbouring slides on each
 * side (local context), the selected slides in full, the slide-type catalog,
 * and the user's feedback — and returns a revised section that replaces the
 * selected range (slide count may change).
 */
import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent } from '../llm/index.js';
import { extractJsonObject } from '../openai/json.js';
import { normalizeLang } from '../openai/lang.js';
import { summarizeDeckForPrompt } from '../openai/prompt.js';
import { presentationToDeck } from '../../../shared/slide-types.js';
import { buildPhase2CatalogPrompt } from './slide-type-catalog.js';

/** Number of slides of local context included on each side of the selection. */
const NEIGHBOUR_COUNT = 2;

const slideForPrompt = (s) => ({ type: s?.type, content: s?.content || {} });

/**
 * @param {Object} presentation - The full presentation (slides array with ids)
 * @param {Object} options
 * @param {number} options.start - Index of the first selected slide
 * @param {number} options.end - Index of the last selected slide (inclusive)
 * @param {string} options.feedback - What the user wants changed
 * @param {string} [options.targetLang] - 'nl' | 'en-GB'
 * @param {string} [options.vendor] - LLM vendor override
 * @param {string[]} [options.disabledSlideTypes]
 * @param {Array} [options.customSlideTypes]
 * @returns {Promise<{slides: Array, rationale: string, review: Array}>}
 *   Revised section slides (raw {type, content, why}) + rationale; `review`
 *   carries per-slide why aligned by index (normalization strips unknown keys).
 */
export async function refineSectionWithAi(
  presentation,
  {
    start,
    end,
    feedback,
    targetLang = null,
    vendor = null,
    disabledSlideTypes = [],
    customSlideTypes = [],
  } = {}
) {
  const { vendor: resolvedVendor, apiKey, model } = getLlmConfig({ vendor });

  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];
  const selected = slides.slice(start, end + 1);
  const before = slides.slice(Math.max(0, start - NEIGHBOUR_COUNT), start);
  const after = slides.slice(end + 1, end + 1 + NEIGHBOUR_COUNT);

  const requestedLang = normalizeLang(targetLang);
  const langLabel =
    requestedLang === 'nl'
      ? 'DUTCH'
      : requestedLang === 'en-GB'
      ? 'ENGLISH (UK)'
      : 'the same language as the existing slides';

  const deckSummary = summarizeDeckForPrompt(presentationToDeck(presentation), {
    maxSlides: 60,
  });

  const system = [
    'You are revising a SECTION of an existing presentation deck in a self-hosted slide editor.',
    'Return ONLY valid JSON. No markdown fences, no commentary.',
    '',
    'You will receive: a summary of the whole deck, a few slides of context before and after the section, the selected section itself (full JSON), and user feedback about what to change.',
    '',
    'Output MUST be exactly:',
    '{ "rationale": "...", "slides": [ { "type": "...", "content": { ... }, "why": "..." }, ... ] }',
    '- "slides" is the FULL revised section. It REPLACES the selected slides, in order. You may change slide count, types, order, and content — whatever the feedback asks.',
    '- Do NOT return the context slides; only the revised section.',
    '- Do NOT include UUIDs or ids.',
    '- "rationale": 1-2 sentences addressed to the user summarizing what you changed.',
    '- "why" (per slide): ONE short sentence explaining why this slide type fits.',
    `- Write all slide text, the rationale, and the "why" lines in ${langLabel}.`,
    '- Stay coherent with the surrounding context slides (no duplicated content, keep the narrative flowing).',
    '- Apply the feedback fully, but keep material the feedback does not touch intact.',
    '- Do NOT output follow-invite-slide; the app manages that automatically.',
    '',
    buildPhase2CatalogPrompt({ disabledSlideTypes, customSlideTypes }),
  ].join('\n');

  const user = [
    'DECK SUMMARY:',
    deckSummary,
    '',
    `CONTEXT — SLIDES BEFORE THE SECTION (do not change, do not return):`,
    JSON.stringify(before.map(slideForPrompt), null, 2),
    '',
    'SELECTED SECTION (revise this):',
    JSON.stringify(selected.map(slideForPrompt), null, 2),
    '',
    'CONTEXT — SLIDES AFTER THE SECTION (do not change, do not return):',
    JSON.stringify(after.map(slideForPrompt), null, 2),
    '',
    'USER FEEDBACK (what should change in the section):',
    String(feedback || '').trim(),
  ].join('\n');

  const content = await requestChatCompletionContent({
    vendor: resolvedVendor,
    apiKey,
    model,
    temperature: 0.3,
    responseFormat: { type: 'json_object' },
    maxTokens: 12000,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const obj = extractJsonObject(content);
  const revised = obj?.slides;
  if (!Array.isArray(revised) || !revised.length) {
    const err = new Error(
      `${resolvedVendor} did not return a valid revised section ({ slides: [...] }).`
    );
    err.statusCode = 502;
    err.details = String(content || '').slice(0, 5000);
    throw err;
  }

  const rationale = typeof obj?.rationale === 'string' ? obj.rationale.trim() : '';
  const review = revised.map((s) => ({
    why: typeof s?.why === 'string' ? s.why.trim() : '',
  }));
  return { slides: revised, rationale, review };
}
