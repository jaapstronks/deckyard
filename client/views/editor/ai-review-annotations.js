/**
 * Shared AI annotation layer for the deck grid: renders the per-slide "why
 * this type" line plus swappable alternative-type chips. Used by both the
 * add-slides batch review and the whole-deck review modal — only how a
 * swapped slide is committed differs (`replaceSlide`).
 */
import { t } from '../../lib/ui-i18n.js';

/**
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {Function} options.api - API fetch function
 * @param {Object} options.SLIDE_TYPES - Slide type registry
 * @param {string} [options.lang] - Language mode for the conversion call
 * @param {string} [options.vendor] - LLM vendor override
 * @param {Function} options.replaceSlide - (slide, next) => void, commits the
 *   converted slide (and re-renders the grid)
 * @param {Function} [options.setStatus] - (text) => void, progress/error line
 * @returns {{ annotationFor: Function }}
 */
export function createAiReviewAnnotations({
  h,
  api,
  SLIDE_TYPES,
  lang = null,
  vendor = null,
  replaceSlide,
  setStatus = () => {},
} = {}) {
  let inFlight = false;

  const typeLabelFor = (type) =>
    t(`slideType.${type}.label`, SLIDE_TYPES?.[type]?.label || type);

  // Swap a slide to an alternative type via the existing AI slide-conversion
  // endpoint; the previous type becomes the new alternative (the way back).
  const switchToAlternative = async (slide, alt, btn) => {
    if (inFlight) return;
    inFlight = true;
    btn.disabled = true;
    setStatus(t('editor.aiReview.converting', 'Switching slide type…'));
    try {
      const resp = await api('/api/ai/convert-slide', {
        method: 'POST',
        body: JSON.stringify({
          slide: { type: slide.type, content: slide.content },
          toType: alt.type,
          ...(lang ? { lang } : {}),
          ...(vendor ? { vendor } : {}),
        }),
      });
      const converted = resp?.slide;
      if (!converted?.type) {
        throw new Error(t('editor.aiReview.convertFailed', 'Conversion failed.'));
      }
      setStatus('');
      replaceSlide(slide, {
        ...slide,
        type: converted.type,
        content: converted.content || {},
        _aiReasoning: alt.reason || slide._aiReasoning || '',
        _aiAlternatives: [
          {
            type: slide.type,
            reason: t('editor.aiReview.previousType', 'The originally proposed type'),
          },
        ],
      });
    } catch (e) {
      setStatus(String(e?.message || e));
      btn.disabled = false;
    } finally {
      inFlight = false;
    }
  };

  const annotationFor = (slide) => {
    const why = String(slide?._aiReasoning || '').trim();
    const alts = Array.isArray(slide?._aiAlternatives) ? slide._aiAlternatives : [];
    if (!why && !alts.length) return null;
    const holder = h('div', {});
    if (why) holder.append(h('p', { class: 'deck-grid-why', text: why }));
    const row = h('div', { class: 'deck-grid-alt-row' });
    for (const alt of alts) {
      if (!SLIDE_TYPES?.[alt?.type]) continue;
      const btn = h('button', {
        class: 'deck-grid-alt-btn',
        type: 'button',
        title: alt.reason || '',
        text: t('editor.aiReview.switchTo', 'Try as {type}', {
          type: typeLabelFor(alt.type),
        }),
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchToAlternative(slide, alt, btn);
        },
      });
      row.append(btn);
    }
    if (row.children.length) holder.append(row);
    return holder.children.length ? holder : null;
  };

  return { annotationFor };
}
