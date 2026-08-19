/**
 * Read-only AI annotation panels shown at the top of the inspector for
 * AI-generated slides: the type-choice reasoning (with alternatives) and any
 * validation warnings the generator attached.
 *
 * Both are pure builders that read `slide._ai*` fields and return a DOM node
 * (or null when there is nothing to show). They hold no state and touch
 * nothing in the editor's render loop, so they live beside `editor-form.js`.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * "AI type reasoning" disclosure: why the generator picked this type, plus any
 * alternatives it considered.
 *
 * @param {object} ctx
 * @param {(tag: string, props?: object, ...kids: any[]) => HTMLElement} ctx.h
 * @param {object} ctx.slide
 * @returns {HTMLElement|null}
 */
export function buildAiReasoningPanel({ h, slide }) {
  if (!slide._aiReasoning) return null;

  const aiSection = h('details', { class: 'ai-reasoning-panel' });
  const summary = h('summary', { class: 'ai-reasoning-toggle' });
  summary.textContent = t('editor.slide.aiReasoning', 'AI type reasoning');
  aiSection.append(summary);

  const reasoningText = h('p', { class: 'ai-reasoning-text' });
  reasoningText.textContent = slide._aiReasoning;
  aiSection.append(reasoningText);

  // Alternatives: newer slides carry _aiAlternatives [{type, reason}];
  // older stored slides may still have the flat _aiAlternativeType pair.
  const alternatives = Array.isArray(slide._aiAlternatives)
    ? slide._aiAlternatives.filter((a) => a?.type && a?.reason)
    : slide._aiAlternativeType && slide._aiAlternativeReason
      ? [{ type: slide._aiAlternativeType, reason: slide._aiAlternativeReason }]
      : [];
  for (const alt of alternatives) {
    const altDiv = h('div', { class: 'ai-reasoning-alternative' });
    const altLabel = h('strong');
    altLabel.textContent = t('editor.slide.aiAlternativeLabel', 'Alternative:');
    const altCode = h('code');
    altCode.textContent = alt.type;
    // One key for the whole suggestion: {type} marks where the <code> node
    // goes, so translations control word order and punctuation.
    const tpl = t(
      'editor.slide.aiAlternativeSuggestion',
      'Consider {type} — {reason}',
    );
    const [beforeType, afterType = ''] = tpl.split('{type}');
    const fillReason = (s) => s.replace('{reason}', () => String(alt.reason));
    altDiv.append(
      altLabel,
      document.createTextNode(' '),
      document.createTextNode(fillReason(beforeType)),
      altCode,
      document.createTextNode(fillReason(afterType)),
    );
    aiSection.append(altDiv);
  }

  return aiSection;
}

/**
 * Warnings panel: the issues slide validation surfaced for an AI-generated
 * slide.
 *
 * @param {object} ctx
 * @param {(tag: string, props?: object, ...kids: any[]) => HTMLElement} ctx.h
 * @param {object} ctx.slide
 * @returns {HTMLElement|null}
 */
export function buildAiWarningsPanel({ h, slide }) {
  if (!slide._aiWarnings?.length) return null;

  const warningsDiv = h('div', { class: 'ai-warnings' });
  for (const w of slide._aiWarnings) {
    const p = h('p', { class: 'ai-warning-item' });
    p.textContent = t('editor.slide.aiWarningItem', '⚠️ {warning}', {
      warning: w,
    });
    warningsDiv.append(p);
  }
  return warningsDiv;
}
