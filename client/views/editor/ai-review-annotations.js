/**
 * Shared AI annotation layer for the deck grid: renders the per-slide "why
 * this type" line plus swappable alternative-type chips, "Choose image" on a
 * slide that still lacks its picture, and the suggestion row between two
 * slides ("a picture could go here"). Used by both the add-slides batch
 * review and the whole-deck review modal — only how a change is committed
 * differs (`replaceSlide`, `pickImage`, `onSuggestion`).
 */
import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';
import { isAiReviewCurrent, bindAiReview } from '../../../shared/ai-review.js';
import { canPickMissingPicture } from './media/pick-missing-picture.js';
import { insertSlideAfter } from './slide-insert-position.js';
import { newSlide } from '../../../shared/slide-types/presentation.js';

/** The slide type a suggestion inserts: a picture slide with an empty image. */
export const SUGGESTED_PICTURE_TYPE = 'image-slide';

/**
 * @param {Object} options
 * @param {Function} options.api - API fetch function
 * @param {Object} options.SLIDE_TYPES - Slide type registry
 * @param {string} [options.lang] - Language mode for the conversion call
 * @param {string} [options.vendor] - LLM vendor override
 * @param {Function} options.replaceSlide - (slide, next) => void, commits the
 *   converted slide (and re-renders the grid)
 * @param {Function} [options.setStatus] - (text) => void, progress/error line
 * @param {Function} [options.pickImage] - (slide) => void, opens the picker
 *   for a slide's missing picture; without it no "Choose image" shows
 * @param {Function} [options.onSuggestion] - (slide, accepted: boolean) =>
 *   void, commits "Add image slot" (true) or "Dismiss" (false); without it no
 *   suggestion row shows
 * @returns {{ annotationFor: Function, suggestionAfter: Function }}
 */
export function createAiReviewAnnotations({
  api,
  SLIDE_TYPES,
  lang = null,
  vendor = null,
  replaceSlide,
  setStatus = () => {},
  pickImage = null,
  onSuggestion = null,
} = {}) {
  let inFlight = false;

  const typeLabelFor = (type) =>
    t(`slideType.${type}.label`, SLIDE_TYPES?.[type]?.label || type);

  // Swap a slide to an alternative type via the existing AI slide-conversion
  // endpoint. The list stays: the chosen type leaves it, the previous type
  // joins it (the way back).
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
          ...(Array.isArray(slide._aiAlternatives)
            ? slide._aiAlternatives
            : []
          ).filter((other) => other?.type && other.type !== alt.type),
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

  // A slide whose essential picture is still empty stays out of every
  // output; the grid offers the shortcut to fill it.
  const missingPictureRow = (slide) => {
    if (typeof pickImage !== 'function') return null;
    if (!canPickMissingPicture(slide, SLIDE_TYPES)) return null;
    return h('div', { class: 'deck-grid-missing' }, [
      h('p', {
        class: 'deck-grid-review-status',
        text: t(
          'editor.aiReview.missingImage',
          'This slide needs an image. Until then it stays out of the presentation.',
        ),
      }),
      h('div', { class: 'deck-grid-actions' }, [
        h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          text: t('editor.aiReview.chooseImage', 'Choose image'),
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            pickImage(slide);
          },
        }),
      ]),
    ]);
  };

  const reviewParts = (slide) => {
    const why = aiReviewDescription(slide);
    const alts = Array.isArray(slide?._aiAlternatives)
      ? slide._aiAlternatives
      : [];
    if (!why && !alts.length && !slide?._aiReview) return [];
    const parts = [];
    if (why) parts.push(h('p', { class: 'deck-grid-why', text: why }));
    if (slide?._aiReview?.fingerprint && !isAiReviewCurrent(slide)) {
      parts.push(
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
      parts.push(
        h('p', {
          class: 'deck-grid-source-label',
          text: t('editor.aiReview.source', 'From your source'),
        }),
        h('blockquote', { class: 'deck-grid-source', text: excerpt }),
      );
    } else {
      parts.push(
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
    if (row.children.length) parts.push(row);
    return parts;
  };

  const annotationFor = (slide) => {
    const parts = reviewParts(slide);
    const missing = missingPictureRow(slide);
    if (missing) parts.push(missing);
    return parts.length ? h('div', {}, parts) : null;
  };

  // The row between this slide and the next when the model suggested a
  // picture there. Accepting inserts an empty picture slide (product
  // decision 2: a suggestion only ever places a placeholder).
  const suggestionAfter = (slide) => {
    const reason = String(slide?._aiSuggestAfter?.reason || '').trim();
    if (!reason || typeof onSuggestion !== 'function') return null;
    if (!SLIDE_TYPES?.[SUGGESTED_PICTURE_TYPE]) return null;
    const answer = (accepted) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSuggestion(slide, accepted);
    };
    return h(
      'div',
      {
        class: 'deck-grid-suggestion',
        role: 'group',
        'aria-label': t(
          'editor.aiReview.suggestImage',
          'A picture could go here',
        ),
      },
      [
        h('p', {
          class: 'deck-grid-suggestion-title',
          text: t('editor.aiReview.suggestImage', 'A picture could go here'),
        }),
        h('p', { class: 'deck-grid-why', text: reason }),
        h('div', { class: 'deck-grid-actions' }, [
          h('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            text: t('editor.aiReview.addImageSlot', 'Add image slot'),
            onclick: answer(true),
          }),
          h('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            text: t('editor.aiReview.ignoreSuggestion', 'Ignore'),
            onclick: answer(false),
          }),
        ]),
      ],
    );
  };

  return { annotationFor, suggestionAfter };
}

/**
 * Answer a picture suggestion in a slide list: either way the suggestion is
 * gone; accepting inserts one picture slide with the registry's defaults and
 * an empty image behind the suggesting slide, by the editor's one insertion
 * rule (a child slide's suggestion stays inside its parent's group, as the
 * slide list's insert rows do). No AI text goes into the new slide.
 *
 * @param {Object} options
 * @param {Object[]} options.slides - the list the slide lives in, mutated
 * @param {Object} options.slide - the suggesting slide, mutated
 * @param {boolean} options.accepted
 * @param {Object} options.SLIDE_TYPES - the editor's registry
 * @param {Object} [options.theme]
 * @param {string|null} [options.lang]
 * @param {string} [options.presentationId]
 * @returns {Object|null} the inserted slide
 */
export function answerPictureSuggestion({
  slides,
  slide,
  accepted,
  SLIDE_TYPES,
  theme = null,
  lang = null,
  presentationId = '',
}) {
  delete slide._aiSuggestAfter;
  if (!accepted || !SLIDE_TYPES?.[SUGGESTED_PICTURE_TYPE]) return null;
  const placeholder = newSlide({
    type: SUGGESTED_PICTURE_TYPE,
    slideTypes: SLIDE_TYPES,
    lang,
    theme,
    presentationId,
  });
  if (slide.parentId) placeholder.parentId = slide.parentId;
  insertSlideAfter(slides, placeholder, slide.id);
  return placeholder;
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
