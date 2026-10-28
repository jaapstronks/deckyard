/**
 * Shared AI annotation layer for the deck grid: renders the per-slide "why
 * this type" line plus swappable alternative-type chips. Used by both the
 * add-slides batch review and the whole-deck review modal — only how a
 * swapped slide is committed differs (`replaceSlide`).
 */
import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';
import { isAiReviewCurrent, bindAiReview } from '../../../shared/ai-review.js';

/**
 * @param {Object} options
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
        body: {
          slide: { type: slide.type, content: slide.content },
          toType: alt.type,
          ...(lang ? { lang } : {}),
          ...(vendor ? { vendor } : {}),
        },
      });
      const converted = resp?.slide;
      if (!converted?.type) {
        throw new Error(
          t('editor.aiReview.convertFailed', 'Could not switch slide type.'),
        );
      }
      setStatus('');
      const next = {
        ...slide,
        type: converted.type,
        content: converted.content || {},
        _aiReasoning: alt.reason || slide._aiReasoning || '',
        _aiAlternatives: [
          {
            type: slide.type,
            reason: t(
              'editor.aiReview.previousType',
              'The originally proposed type',
            ),
          },
        ],
      };
      bindAiReview(next, { kind: 'content', sourceExcerpt: null });
      replaceSlide(slide, next);
    } catch (e) {
      setStatus(String(e?.message || e));
      btn.disabled = false;
    } finally {
      inFlight = false;
    }
  };

  const annotationFor = (slide) => {
    const why = aiReviewDescription(slide);
    const alts = Array.isArray(slide?._aiAlternatives)
      ? slide._aiAlternatives
      : [];
    if (!why && !alts.length && !slide?._aiReview) return null;
    const holder = h('div', {});
    if (why) holder.append(h('p', { class: 'deck-grid-why', text: why }));
    if (slide?._aiReview?.fingerprint && !isAiReviewCurrent(slide)) {
      holder.append(
        h('p', {
          class: 'deck-grid-review-status',
          text: t(
            'editor.aiReview.stale',
            'This slide has changed. The explanation and source below describe the earlier version.',
          ),
        }),
      );
    }
    const excerpt = slide?._aiReview?.sourceExcerpt;
    if (excerpt) {
      holder.append(
        h('p', {
          class: 'deck-grid-source-label',
          text: t('editor.aiReview.source', 'From your source'),
        }),
      );
      holder.append(
        h('blockquote', { class: 'deck-grid-source', text: excerpt }),
      );
    } else {
      holder.append(
        h('p', {
          class: 'deck-grid-review-status',
          text: t(
            'editor.aiReview.noSource',
            'No source passage could be verified for this explanation.',
          ),
        }),
      );
    }
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

/** User-facing explanation shared by the grid and its enlarged preview. */
export function aiReviewDescription(slide) {
  const kind = slide?._aiReview?.kind;
  if (kind === 'title')
    return t(
      'editor.aiReview.titleReason',
      'This opening introduces the topic of your source.',
    );
  if (kind === 'chapter')
    return t(
      'editor.aiReview.chapterReason',
      'This divider introduces the next section of your source.',
    );
  if (kind === 'quote')
    return t(
      'editor.aiReview.quoteReason',
      'This quotation highlights a passage from your source.',
    );
  if (kind === 'fallback')
    return t(
      'editor.aiReview.fallbackReason',
      'The suggested layout could not be completed. A simple slide preserves the proposed text for you to review.',
    );
  if (kind === 'closing')
    return t(
      'editor.aiReview.closingReason',
      'This closing brings the main message together.',
    );
  return String(slide?._aiReasoning || '').trim();
}

/** The preview carries the same evidence and freshness status as its tile. */
export function aiReviewPreviewText(slide) {
  const parts = [aiReviewDescription(slide)];
  if (slide?._aiReview?.fingerprint && !isAiReviewCurrent(slide))
    parts.push(
      t(
        'editor.aiReview.stale',
        'This slide has changed. The explanation and source below describe the earlier version.',
      ),
    );
  parts.push(
    slide?._aiReview?.sourceExcerpt
      ? `${t('editor.aiReview.source', 'From your source')}: “${slide._aiReview.sourceExcerpt}”`
      : t(
          'editor.aiReview.noSource',
          'No source passage could be verified for this explanation.',
        ),
  );
  return parts.filter(Boolean).join('\n\n');
}
