/**
 * Viewer mode slides panel.
 * Reuses the same layout/structure as the editor's slide list for consistency.
 */

import { renderSlideElement } from '../../lib/slide-render.js';
import { t } from '../../lib/ui-i18n.js';
import { isDraftSlide } from '../../../shared/slide-visibility.js';

export function createViewerSlidesPanel({
  h,
  pres,
  theme,
  getSelectedSlideId,
  setSelectedSlideId,
  getSlideCommentCount,
} = {}) {
  // Use same structure as editor: panel > panel-scroll > list
  const panelEl = h('div', { class: 'panel slides-panel viewer-slides-panel' });
  const panelHeader = h('div', { class: 'slides-panel-header' }, [
    h('h2', { text: t('viewer.slides.title', 'Slides') }),
  ]);
  const panelScroll = h('div', { class: 'panel-scroll' });
  const listEl = h('div', { class: 'list' });

  panelScroll.append(listEl);
  panelEl.append(panelHeader, panelScroll);

  const rerenderSlideList = () => {
    listEl.innerHTML = '';
    const slides = pres?.slides || [];
    const selectedId = getSelectedSlideId?.();

    slides.forEach((slide, index) => {
      const isActive = slide.id === selectedId;

      // Use same classes as editor: list-item slide-item
      const item = h('div', {
        class: `list-item slide-item${isActive ? ' is-active' : ''}`,
        'data-slide-id': slide.id,
        tabindex: -1,
        role: 'button',
        'aria-label': t('editor.slideList.selectSlideN', 'Select slide {n}', { n: index + 1 }),
      });

      // Collapsed rail number (hidden in expanded mode, shown in collapsed)
      const numCollapsed = h('div', {
        class: 'slide-num-collapsed',
        text: String(index + 1),
      });

      // Thumbnail container - same structure as editor
      const thumbMini = h('div', { class: 'thumb thumb-mini' });
      try {
        thumbMini.append(renderSlideElement(slide, { mode: 'thumb', theme, presentationId: pres?.id }));
      } catch {
        // ignore render errors
      }

      // Slide number overlay inside thumbnail (top-left corner)
      const numOverlay = h('div', {
        class: 'slide-num-overlay',
        text: String(index + 1),
      });
      thumbMini.append(numOverlay);

      // Comment indicator (if has comments)
      const commentCount = getSlideCommentCount?.(slide.id) || 0;
      if (commentCount > 0) {
        const commentIndicator = h('div', {
          class: 'slide-comment-indicator',
          text: String(commentCount),
          title: t('editor.slideList.commentsOnSlide', '{n} comment(s)', { n: commentCount }),
        });
        thumbMini.append(commentIndicator);
      }

      // Draft slide indicator (for view-only users)
      // Check both _isDraft flag (set by server) and visibility preset
      const slideIsDraft = slide._isDraft || isDraftSlide(slide);
      if (slideIsDraft) {
        item.classList.add('is-draft');
        const draftBadge = h('div', {
          class: 'slide-draft-badge',
          text: t('visibility.draft', 'Draft'),
          title: t('viewer.draftSlide', 'Draft - Not finalized'),
        });
        thumbMini.append(draftBadge);
      }

      item.append(numCollapsed, thumbMini);

      // Click to select (no dragging, no multi-select)
      item.addEventListener('click', () => {
        setSelectedSlideId?.(slide.id);
      });

      listEl.append(item);
    });
  };

  const detach = () => {
    // No cleanup needed
  };

  return {
    panelEl,
    rerenderSlideList,
    detach,
  };
}