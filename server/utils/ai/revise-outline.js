/**
 * Outline Revision (Phase 1b)
 *
 * A second pass over the outline before any slides are built.
 *
 * Planning a deck well is hard to do in one shot, but an outline is small and
 * highly structured — cheap to review. So rather than trying to get phase 1
 * right first time, this stage reads the plan back against the source and
 * corrects it.
 *
 * The reviser does NOT rewrite the outline. It returns explicit operations
 * (merge / drop / reorder) which are applied deterministically here. That
 * matters: an earlier experiment that simply instructed the model to "cut
 * repeated facts" lost real content — the deck stopped mentioning figures that
 * belonged in it. Operations make every change auditable, make merges
 * content-preserving by construction, and let a safety cap reject a revision
 * that would gut the deck.
 */

import { getLlmConfig } from '../llm/config.js';
import { requestChatCompletionContent, LlmError } from '../llm/index.js';
import { extractJsonObject } from '../openai/json.js';
import { prompts } from './prompts/index.js';

/** Reject a revision that would drop more than this share of content slides. */
const MAX_DROP_RATIO = 0.25;

/**
 * Apply revision operations to an outline.
 *
 * Pure and deterministic: the model decides *what* to change, this decides
 * whether the change is safe and carries it out.
 *
 * @param {object} outline
 * @param {Array<object>} operations
 * @returns {{outline: object, applied: object[], rejected: {operation: object, why: string}[]}}
 */
export function applyRevisionOperations(outline, operations) {
  const slides = [...(outline.slides || [])];
  const applied = [];
  const rejected = [];

  const contentCount = slides.filter((s) => s.intent === 'content').length;
  const maxDrops = Math.floor(contentCount * MAX_DROP_RATIO);

  // Index -> slide, so operations can reference stable positions while the
  // array is being mutated.
  const byPosition = new Map(slides.map((slide, i) => [i + 1, slide]));
  const touched = new Set();
  const removed = new Set();
  let drops = 0;

  const reject = (operation, why) => rejected.push({ operation, why });

  for (const operation of Array.isArray(operations) ? operations : []) {
    const positions =
      operation.type === 'merge'
        ? operation.slides
        : [operation.slide].filter((n) => n != null);

    if (!positions?.length || positions.some((p) => !byPosition.has(p))) {
      reject(operation, 'references a slide that does not exist');
      continue;
    }
    if (positions.some((p) => touched.has(p))) {
      reject(operation, 'a slide may appear in only one operation');
      continue;
    }
    // Structural slides are resolved directly and carry no refinable content.
    if (positions.some((p) => byPosition.get(p).intent !== 'content')) {
      reject(operation, 'only content slides may be revised');
      continue;
    }

    if (operation.type === 'merge') {
      if (positions.length !== 2) {
        reject(operation, 'merge takes exactly two slides');
        continue;
      }
      if (!String(operation.roughContent || '').trim()) {
        reject(operation, 'merge must supply the combined content');
        continue;
      }
      const [first, second] = positions.slice().sort((a, b) => a - b);
      const target = byPosition.get(first);
      const source = byPosition.get(second);

      target.roughContent = operation.roughContent;
      target.presenterNotes =
        operation.presenterNotes ||
        [target.presenterNotes, source.presenterNotes].filter(Boolean).join(' ');
      target.hints = [...new Set([...(target.hints || []), ...(source.hints || [])])];

      removed.add(second);
      positions.forEach((p) => touched.add(p));
      applied.push({ ...operation, resolved: `merged ${second} into ${first}` });
      continue;
    }

    if (operation.type === 'drop') {
      if (drops >= maxDrops) {
        reject(operation, `drop cap reached (${maxDrops} of ${contentCount} content slides)`);
        continue;
      }
      removed.add(positions[0]);
      touched.add(positions[0]);
      drops += 1;
      applied.push({ ...operation, resolved: `dropped ${positions[0]}` });
      continue;
    }

    if (operation.type === 'reorder') {
      if (!byPosition.has(operation.after)) {
        reject(operation, 'reorder target does not exist');
        continue;
      }
      touched.add(positions[0]);
      applied.push({ ...operation, resolved: `moved ${positions[0]} after ${operation.after}` });
      continue;
    }

    reject(operation, `unknown operation "${operation.type}"`);
  }

  // Rebuild in order: drop removed slides, then apply reorders.
  let revised = slides.filter((_, i) => !removed.has(i + 1));

  for (const operation of applied.filter((op) => op.type === 'reorder')) {
    const moving = byPosition.get(operation.slide);
    const anchor = byPosition.get(operation.after);
    const from = revised.indexOf(moving);
    if (from === -1) continue;
    revised.splice(from, 1);
    const to = revised.indexOf(anchor);
    if (to === -1) revised.splice(from, 0, moving);
    else revised.splice(to + 1, 0, moving);
  }

  // Renumber so downstream grouping sees a contiguous outline.
  revised = revised.map((slide, i) => ({ ...slide, index: i }));

  return { outline: { ...outline, slides: revised }, applied, rejected };
}

/**
 * Review and revise an outline.
 *
 * Failure is non-fatal: a revision that errors, returns nothing usable, or is
 * rejected by the safety checks leaves the original outline untouched. A deck
 * that is merely un-revised is far better than no deck.
 *
 * @param {object} outline - Outline from generateOutline
 * @param {string} rawContent - The source document
 * @param {Object} options
 * @param {string|null} [options.vendor]
 * @param {string} [options.lang]
 * @param {Function|null} [options.onLog]
 * @returns {Promise<{outline: object, revision: object|null}>}
 */
export async function reviseOutline(outline, rawContent, { vendor = null, lang = 'en', onLog = null } = {}) {
  const langLabel = lang === 'nl' ? 'DUTCH' : 'ENGLISH';
  const config = getLlmConfig({ vendor, role: 'plan' });

  const system = prompts.buildRevisionSystemPrompt(langLabel);
  const user = prompts.buildRevisionUserPrompt(outline, rawContent);
  const startedAt = Date.now();

  let parsed = null;
  try {
    const content = await requestChatCompletionContent({
      ...config,
      temperature: 0.3,
      maxTokens: 8000,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    parsed = extractJsonObject(content);
  } catch (err) {
    const message = err instanceof LlmError ? err.message : String(err?.message || err);
    console.warn(`[Revise] Outline revision failed, keeping the draft: ${message}`);
    return { outline, revision: null };
  }

  if (!parsed || !Array.isArray(parsed.operations)) {
    console.warn('[Revise] Outline revision returned no usable operations, keeping the draft');
    return { outline, revision: null };
  }

  const { outline: revisedOutline, applied, rejected } = applyRevisionOperations(
    outline,
    parsed.operations
  );

  const revision = {
    assessment: parsed.assessment || '',
    proposed: parsed.operations.length,
    applied,
    rejected,
    durationMs: Date.now() - startedAt,
    model: config.model,
  };

  console.log(
    `[Revise] ${applied.length}/${parsed.operations.length} operations applied ` +
      `(${outline.slides.length} -> ${revisedOutline.slides.length} slides)` +
      (rejected.length ? `, ${rejected.length} rejected` : '')
  );

  if (onLog) onLog({ system, user, revision });

  return { outline: revisedOutline, revision };
}
