/**
 * Render a comment body with @mention markup as inline chips.
 *
 * A mention is stored in the body as the marker `@[Name](user:email)` (see
 * `shared/comment-mentions.js`). Everywhere a comment body is shown to a reader
 * we render those markers as a subtle `.comment-mention-chip` span and keep the
 * rest as plain text nodes. Using `h()` text nodes means no manual escaping.
 *
 * Shared by every comment-body render surface (editor thread, share viewer,
 * preview lightbox) so a chip looks the same everywhere.
 */

import { splitCommentSegments } from '../../../shared/comment-mentions.js';
import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Build DOM nodes for a comment body: mention markers become chips, the rest
 * stays plain text. Append them with `el.append(...renderCommentBodyNodes(...))`.
 *
 * @param {string} body - Raw comment body (may contain mention markup).
 *   The DOM helper (injected so this works in both editor and viewer contexts).
 * @returns {Array<HTMLElement|string>} Nodes/text ready for `.append(...)`.
 */
export function renderCommentBodyNodes(body) {
  const nodes = [];
  for (const seg of splitCommentSegments(body)) {
    if (seg.type === 'mention') {
      nodes.push(
        h('span', {
          class: 'comment-mention-chip',
          title: seg.email,
          text: `@${seg.name}`,
        }),
      );
    } else if (seg.type === 'link') {
      // The URL is already scheme-checked by the parser (`safeLinkUrl`), so an
      // unsafe target never reaches this branch — it stays literal text.
      nodes.push(
        h('a', {
          class: 'comment-body-link',
          href: seg.url,
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
          title: seg.url,
          text: seg.label,
        }),
      );
    } else {
      nodes.push(seg.text);
    }
  }
  return nodes;
}

/**
 * The name a reader sees for a comment's author. The API sends the author as
 * `comment.author` (D22) and flags the configured AI identity with `isAi`; an
 * AI suggestion shows as the assistant whoever posted it.
 *
 * @param {Object} comment - A comment in the API shape.
 * @returns {string}
 */
export function commentAuthorName(comment) {
  if (comment?.commentType === 'ai-suggestion' || comment?.isAi) {
    return t('comments.aiAuthor', 'AI Assistant');
  }
  return comment?.author?.displayName || t('comments.unknownAuthor', 'Unknown');
}

/**
 * The start of a comment body as plain text: mentions read as `@Name`, links
 * as their label, whitespace collapsed, cut at `max` characters with an
 * ellipsis.
 *
 * @param {string} body - Raw comment body (may contain mention/link markup).
 * @param {number} [max=50]
 * @returns {string}
 */
export function commentExcerpt(body, max = 50) {
  const text = splitCommentSegments(body)
    .map((seg) =>
      seg.type === 'mention'
        ? `@${seg.name}`
        : seg.type === 'link'
          ? seg.label
          : seg.text,
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
