/**
 * Comment markers component for rendering positioned comments on slides.
 * Displays pin markers at comment positions and handles click-to-add mode.
 */

import { t } from '../../lib/ui-i18n.js';

/**
 * Creates comment markers component for a slide preview.
 * @param {Object} options - Configuration options
 * @param {Function} options.h - DOM helper function
 * @param {HTMLElement} options.containerEl - The container element to render markers into
 * @param {Function} options.onMarkerClick - Callback when clicking a marker (receives comment)
 * @param {Function} options.onPositionSelect - Callback when selecting a position to add comment (receives {x, y})
 * @returns {Object} Markers API
 */
export function createCommentMarkers({
  h,
  containerEl,
  onMarkerClick,
  onPositionSelect,
}) {
  let comments = [];
  let isAddMode = false;
  let markersContainer = null;

  // Create markers container
  markersContainer = h('div', { class: 'comment-markers-container' });
  containerEl.style.position = 'relative';
  containerEl.appendChild(markersContainer);

  // Re-append the markers container if the parent's contents were wiped
  // (e.g. mountSlideInto sets innerHTML = '' on every rerender)
  function ensureAttached() {
    if (!markersContainer) return;
    if (markersContainer.parentNode !== containerEl) {
      containerEl.style.position = 'relative';
      containerEl.appendChild(markersContainer);
    }
  }

  // Click handler for add mode
  function handleContainerClick(e) {
    if (!isAddMode) return;
    // Ignore clicks on existing markers
    if (e.target.closest('.comment-marker')) return;

    // Calculate position as percentage
    const rect = containerEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    // Clamp to valid range
    const posX = Math.max(0, Math.min(100, x));
    const posY = Math.max(0, Math.min(100, y));

    onPositionSelect?.({ x: posX, y: posY });
  }

  containerEl.addEventListener('click', handleContainerClick);

  function renderMarkers() {
    ensureAttached();
    markersContainer.innerHTML = '';

    // Only render positioned comments (with positionX and positionY)
    const positionedComments = comments.filter(
      (c) => typeof c.positionX === 'number' && typeof c.positionY === 'number'
    );

    for (const comment of positionedComments) {
      const marker = createMarker(comment);
      markersContainer.appendChild(marker);
    }
  }

  function createMarker(comment) {
    // Clamp position to keep markers visible within bounds (accounting for marker size)
    // Markers are 24px with transform: translate(-50%, -50%), so need ~5% padding
    const clampedX = Math.max(5, Math.min(95, comment.positionX));
    const clampedY = Math.max(5, Math.min(95, comment.positionY));

    const marker = h('button', {
      class: `comment-marker ${comment.status === 'resolved' ? 'is-resolved' : ''}`,
      type: 'button',
      title: `${comment.authorName || comment.authorEmail}: ${comment.body.substring(0, 50)}${comment.body.length > 50 ? '...' : ''}`,
      style: `left: ${clampedX}%; top: ${clampedY}%;`,
    });

    // Marker icon (pin)
    const icon = h('img', { class: 'comment-marker-icon', src: '/client/vendor/lucide-icons/map-pin.svg', alt: '', 'aria-hidden': 'true' });
    marker.appendChild(icon);

    // Reply count badge if has replies
    if (comment.replies && comment.replies.length > 0) {
      const badge = h('span', {
        class: 'comment-marker-badge',
        text: String(comment.replies.length + 1),
      });
      marker.appendChild(badge);
    }

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      onMarkerClick?.(comment);
    });

    return marker;
  }

  function setComments(newComments) {
    comments = newComments || [];
    renderMarkers();
  }

  function enterAddMode() {
    isAddMode = true;
    containerEl.classList.add('is-add-comment-mode');
  }

  function exitAddMode() {
    isAddMode = false;
    containerEl.classList.remove('is-add-comment-mode');
  }

  function toggleAddMode() {
    if (isAddMode) exitAddMode();
    else enterAddMode();
    return isAddMode;
  }

  function isInAddMode() {
    return isAddMode;
  }

  function refresh() {
    renderMarkers();
  }

  function destroy() {
    containerEl.removeEventListener('click', handleContainerClick);
    markersContainer?.remove();
    containerEl.classList.remove('is-add-comment-mode');
  }

  return {
    setComments,
    enterAddMode,
    exitAddMode,
    toggleAddMode,
    isInAddMode,
    refresh,
    reattach: ensureAttached,
    destroy,
  };
}