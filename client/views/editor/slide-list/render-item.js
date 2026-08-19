/**
 * Slide Item Renderer
 * Renders individual slide items in the slide list
 */

import { oneLine, slideLabel, slidePrimaryLabel } from '../editor-utils.js';
import { t } from '../../../lib/ui-i18n.js';
import { getVisibilityPreset } from '../../../../shared/slide-visibility.js';
import {
  createVisibilityBadge,
  createVisibilityToggle,
  createVisibilityMenu,
  showVisibilityMenuAt,
} from '../slide-visibility-menu.js';
import { isParentSlide, createChevronSvg } from './nested-helpers.js';
import { normalizeQuery, renderHighlightedText } from './search.js';

/**
 * Add, update or remove the concurrent-lock affordances on one slide row.
 *
 * Shared by the full render and by the in-place patch in slide-list.js, so the
 * markup a lock produces is defined once. Both indicators are absolutely
 * positioned overlays, so append order carries no meaning.
 *
 * @param {Object} opts
 * @param {Function} opts.h DOM helper
 * @param {HTMLElement} opts.item The `.list-item` row
 * @param {HTMLElement} [opts.thumbEl] The row's `.thumb.thumb-mini` (looked up when omitted)
 * @param {HTMLElement} [opts.numCollapsedEl] The row's `.slide-num-collapsed` (looked up when omitted)
 * @param {Object|null} opts.lockInfo Lock record for the slide, if any
 * @param {boolean} opts.lockedByOther Whether another user holds the lock
 */
export function applySlideLockIndicator({
  h,
  item,
  thumbEl,
  numCollapsedEl,
  lockInfo,
  lockedByOther,
}) {
  if (!item) return;
  const active = !!lockedByOther && !!lockInfo;
  item.classList.toggle('is-locked-by-other', active);

  const existing = item.querySelector('.slide-lock-indicator');
  const existingCollapsed = item.querySelector(
    '.slide-lock-indicator-collapsed',
  );

  if (!active) {
    existing?.remove();
    existingCollapsed?.remove();
    return;
  }

  const lockedBy = lockInfo.holderName || lockInfo.holderEmail || '';
  const lockTitle = t('editor.slideList.lockedBy', 'Locked by {name}', {
    name: lockedBy,
  });

  const thumb = thumbEl || item.querySelector('.thumb.thumb-mini');
  if (existing) {
    existing.title = lockTitle;
  } else if (thumb) {
    thumb.append(h('div', { class: 'slide-lock-indicator', title: lockTitle }));
  }

  const numCollapsed =
    numCollapsedEl || item.querySelector('.slide-num-collapsed');
  if (existingCollapsed) {
    existingCollapsed.title = lockTitle;
  } else if (numCollapsed) {
    numCollapsed.append(
      h('div', { class: 'slide-lock-indicator-collapsed', title: lockTitle }),
    );
  }
}

/**
 * Create a slide item element
 */
export function createSlideItem({
  h,
  slide,
  match,
  options = {},
  context = {},
}) {
  const { isChild = false, isHidden = false } = options;

  const {
    pres,
    selectedSlideId,
    multiSelectedIds,
    searchActive,
    indexById,
    childrenMap,
    collapsedParents,
    SLIDE_TYPES,
    renderSlideElement,
    getSlideCommentCount,
    getSlideLockInfo,
    isSlideLockedByOther,
    isSlideAuthorLocked,
    isAuthor,
    markDirty,
    rerenderSlideList,
    rerenderEditor,
    rerenderPreview,
    toggleCollapsed,
  } = context;

  const s = slide;
  const item = h('div', { class: 'list-item slide-item' });
  item.dataset.slideId = s.id;
  if (s.id === selectedSlideId) item.classList.add('is-active');
  if (multiSelectedIds.has(s.id)) item.classList.add('is-selected');

  // Nested slide classes
  const hasChildren = isParentSlide(s.id, childrenMap);
  const isCollapsed = collapsedParents.has(s.id);

  if (isChild) {
    item.classList.add('slide-item--child');
    if (isHidden) item.classList.add('is-hidden');
  }
  if (hasChildren) {
    item.classList.add('slide-item--parent');
    if (!isCollapsed) item.classList.add('slide-item--expanded');
  }

  // Make items programmatically focusable for arrow-key navigation
  item.tabIndex = -1;
  item.setAttribute('role', 'button');
  const originalIdx = indexById.has(s.id) ? indexById.get(s.id) : 0;
  item.setAttribute(
    'aria-label',
    t('editor.slideList.selectSlideN', 'Select slide {n}', {
      n: Number(originalIdx) + 1,
    }),
  );

  const isDisabled =
    s?.type === 'follow-invite-slide' &&
    s?.content &&
    typeof s.content === 'object' &&
    s.content.enabled === false;
  if (isDisabled) item.classList.add('is-disabled');

  const fullTitle = slideLabel(s, SLIDE_TYPES);

  // Collapse/expand toggle for parent slides
  if (hasChildren && !searchActive) {
    const collapseToggle = h('button', {
      class: 'slide-collapse-toggle',
      type: 'button',
      title: isCollapsed
        ? t('editor.slideList.expand', 'Expand')
        : t('editor.slideList.collapse', 'Collapse'),
      onclick: (e) => {
        e.stopPropagation();
        toggleCollapsed(s.id);
      },
    });
    collapseToggle.appendChild(createChevronSvg());
    item.append(collapseToggle);
  }

  // Collapsed rail: standalone number
  const numCollapsed = h('div', {
    class: 'slide-num-collapsed',
    title: oneLine(fullTitle),
  });
  numCollapsed.append(h('span', { text: String(Number(originalIdx) + 1) }));

  // PowerPoint/Keynote style: thumbnail with overlaid slide number
  const thumbMini = h('div', {
    class: 'thumb thumb-mini',
    title: oneLine(fullTitle),
  });
  try {
    thumbMini.append(
      renderSlideElement(s, { mode: 'thumb', presentationId: pres?.id }),
    );
  } catch {
    // ignore render errors in list
  }

  // Slide number overlay
  const numOverlay = h('div', {
    class: 'slide-num-overlay',
    text: String(Number(originalIdx) + 1),
  });
  thumbMini.append(numOverlay);

  // Comment indicator
  const commentCount = getSlideCommentCount?.(s.id) || 0;
  if (commentCount > 0) {
    const commentIndicator = h('div', {
      class: 'slide-comment-indicator',
      text: String(commentCount),
      title: t('editor.slideList.commentsOnSlide', '{n} comment(s)', {
        n: commentCount,
      }),
    });
    thumbMini.append(commentIndicator);
  }

  // Visibility badge and toggle
  const visibilityPreset = getVisibilityPreset(s);
  if (visibilityPreset !== 'visible') {
    item.classList.add('has-visibility');
    item.classList.add('is-visibility-hidden');
    const badge = createVisibilityBadge({ h, slide: s });
    if (badge) thumbMini.append(badge);
  }

  // Visibility toggle button (show on hover)
  const visibilityToggle = createVisibilityToggle({
    h,
    slide: s,
    onToggle: (e) => {
      const menu = createVisibilityMenu({
        h,
        slide: s,
        onVisibilityChange: () => {
          markDirty?.();
          rerenderSlideList();
          rerenderEditor?.();
          rerenderPreview?.();
        },
        onClose: () => {
          const existingMenu = document.body.querySelector('.visibility-menu');
          existingMenu?.remove();
        },
      });
      showVisibilityMenuAt({
        anchor: e.currentTarget,
        menu,
        container: document.body,
      });
    },
  });
  thumbMini.append(visibilityToggle);

  // Author lock indicator
  const authorLocked = isSlideAuthorLocked?.(s.id) || !!s.lockedByAuthor;
  if (authorLocked) {
    const isCurrentUserAuthor = isAuthor?.() || false;
    const lockTitle = isCurrentUserAuthor
      ? t('editor.slideList.authorLocked', 'Locked (click to unlock)', {})
      : t('editor.slideList.authorLockedOther', 'Locked by author', {});
    const authorLockIndicator = h('div', {
      class: 'slide-author-lock-indicator',
      title: lockTitle,
    });
    thumbMini.append(authorLockIndicator);
    const authorLockIndicatorCollapsed = h('div', {
      class: 'slide-author-lock-indicator-collapsed',
      title: lockTitle,
    });
    numCollapsed.append(authorLockIndicatorCollapsed);
    item.classList.add('is-author-locked');
  }

  // Lock indicator (concurrent editing)
  applySlideLockIndicator({
    h,
    item,
    thumbEl: thumbMini,
    numCollapsedEl: numCollapsed,
    lockInfo: getSlideLockInfo?.(s.id) || null,
    lockedByOther: isSlideLockedByOther?.(s.id) || false,
  });

  // Search results: show title and snippet below thumbnail
  const q = searchActive ? normalizeQuery(context.getSearchQuery?.()) : '';
  const primary = slidePrimaryLabel(s, SLIDE_TYPES);
  const searchMeta = searchActive
    ? h('div', { class: 'slide-search-meta' }, [
        h(
          'div',
          {
            class: 'slide-title-line',
            title: oneLine(fullTitle),
          },
          renderHighlightedText(h, primary, q),
        ),
        match?.snippet
          ? h(
              'div',
              {
                class: 'slide-search-snippet',
                title: oneLine(match.snippet),
              },
              [
                h('span', {
                  class: 'slide-search-src',
                  text:
                    match.source === 'notes'
                      ? t('editor.slideList.src.notes', 'Notes: ')
                      : t('editor.slideList.src.text', 'Text: '),
                }),
                ...renderHighlightedText(h, match.snippet, q),
              ],
            )
          : null,
      ])
    : null;

  // Children count badge for collapsed parents
  if (hasChildren && isCollapsed) {
    const childCount = childrenMap.get(s.id)?.length || 0;
    if (childCount > 0) {
      const childrenCountBadge = h('div', {
        class: 'slide-children-count',
        text: String(childCount),
        title: t('editor.slideList.childrenCount', '{n} nested slide(s)', {
          n: childCount,
        }),
      });
      thumbMini.append(childrenCountBadge);
    }
  }

  item.append(numCollapsed, thumbMini);
  if (searchMeta) item.append(searchMeta);

  return { item, originalIdx, isChild };
}
