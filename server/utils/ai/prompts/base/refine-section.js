/**
 * Base prompt copy — section refine (revise a contiguous range of slides).
 *
 * OSS-default prompt content for the whole-deck review grid's "Adjust section"
 * action. Overridable via `custom/ai/prompts.js`. The mechanism — selecting the
 * range, gathering neighbour context, the LLM call and result normalization —
 * stays in `refine-section.js`, which computes `langLabel` and the slice arrays
 * and passes them in.
 */

import { buildPhase2CatalogPrompt } from '../../slide-type-catalog.js';

const slideForPrompt = (s) => ({ type: s?.type, content: s?.content || {} });

/**
 * Build the system prompt for a section refine.
 *
 * @param {Object} params
 * @param {string} params.langLabel - Resolved output-language label.
 * @param {string[]} [params.disabledSlideTypes]
 * @param {Array} [params.customSlideTypes]
 * @returns {string}
 */
export function buildSectionSystemPrompt({ langLabel, disabledSlideTypes = [], customSlideTypes = [] }) {
  return [
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
}

/**
 * Build the user prompt for a section refine.
 *
 * @param {Object} params
 * @param {string} params.deckSummary - Prompt-ready summary of the whole deck.
 * @param {Array} params.before - Context slides before the section.
 * @param {Array} params.selected - The slides to revise.
 * @param {Array} params.after - Context slides after the section.
 * @param {string} params.feedback - What the user wants changed.
 * @returns {string}
 */
export function buildSectionUserPrompt({ deckSummary, before, selected, after, feedback }) {
  return [
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
}
