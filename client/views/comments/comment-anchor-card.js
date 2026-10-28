/**
 * The cards that open on a spot of the slide: the composer for a new
 * anchored comment and the read-only view of an existing one. Both share one
 * frame, `.positioned-comment-popup`, placed at the pin inside the stage and
 * flipped by the anchor-* classes so it never clips past an edge.
 */

import { t } from '../../lib/ui-i18n.js';
import { h } from '../../lib/dom/index.js';
import { icon } from '../../lib/dom/icons.js';
import { formatRelativeTime } from '../../lib/format/format-time.js';
import { commentAuthorName, renderCommentBodyNodes } from './comment-body.js';

/**
 * Build the card frame at a slide position and attach it to `stageEl`.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.stageEl - Positioning context (not clipped).
 * @param {HTMLElement} opts.thumbEl - The slide box the percentages refer to.
 * @param {number} opts.x - Percent of the slide width.
 * @param {number} opts.y - Percent of the slide height.
 * @param {string} [opts.className] - Extra class naming the card's kind.
 * @returns {HTMLElement}
 */
export function createAnchorCardFrame({ stageEl, thumbEl, x, y, className }) {
  const thumbRect = thumbEl.getBoundingClientRect();
  const stageRect = stageEl.getBoundingClientRect();
  const pixelX = thumbRect.left - stageRect.left + (x / 100) * thumbRect.width;
  const pixelY = thumbRect.top - stageRect.top + (y / 100) * thumbRect.height;

  // Smart positioning: avoid edge clipping
  const classes = ['positioned-comment-popup'];
  if (className) classes.push(className);
  if (x > 50) classes.push('anchor-right');
  if (y > 60) classes.push('anchor-bottom');
  const el = h('div', {
    class: classes.join(' '),
    style: `left: ${pixelX}px; top: ${pixelY}px;`,
  });
  el.append(h('div', { class: 'positioned-comment-marker' }));

  stageEl.style.position = 'relative';
  stageEl.appendChild(el);
  return el;
}

/** Author and relative time, the way a thread in the comments pane shows them. */
function commentHeader(comment) {
  return h('div', { class: 'comment-item-header' }, [
    h('span', { class: 'comment-author', text: commentAuthorName(comment) }),
    h('span', {
      class: 'comment-time',
      text: formatRelativeTime(comment.createdAt),
    }),
  ]);
}

function commentBody(comment) {
  const bodyEl = h('div', { class: 'comment-body' });
  bodyEl.append(...renderCommentBodyNodes(comment.body));
  return bodyEl;
}

/**
 * The card that shows an existing anchored comment and its replies at its
 * pin, laid out like a thread in the comments pane.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.stageEl - Positioning context (not clipped).
 * @param {HTMLElement} opts.thumbEl - The slide box the percentages refer to.
 * @param {Object} opts.comment - Comment with `positionX`/`positionY` and replies.
 * @param {() => void} opts.onClose
 * @returns {{ el: HTMLElement, detach: Function }}
 */
export function createAnchoredCommentDetail({
  stageEl,
  thumbEl,
  comment,
  onClose,
}) {
  const el = createAnchorCardFrame({
    stageEl,
    thumbEl,
    x: comment.positionX,
    y: comment.positionY,
    className: 'comment-detail-popup',
  });

  const header = commentHeader(comment);
  header.append(
    h(
      'button',
      {
        class: 'btn btn-secondary btn-sm is-icon-only comment-detail-close',
        type: 'button',
        'aria-label': t('common.close', 'Close'),
        onclick: () => onClose(),
      },
      [icon('x', { size: 14 })],
    ),
  );

  const thread = h('div', { class: 'comment-item' }, [
    header,
    commentBody(comment),
  ]);
  const replies = (comment.replies || []).map((reply) =>
    h('div', { class: 'comment-item comment-reply' }, [
      commentHeader(reply),
      commentBody(reply),
    ]),
  );
  el.append(thread, ...replies);

  return { el, detach: () => el.remove() };
}
