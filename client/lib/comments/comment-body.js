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

/**
 * Build DOM nodes for a comment body: mention markers become chips, the rest
 * stays plain text. Append them with `el.append(...renderCommentBodyNodes(...))`.
 *
 * @param {string} body - Raw comment body (may contain mention markup).
 * @param {(tag: string, attrs?: object, children?: any) => HTMLElement} h -
 *   The DOM helper (injected so this works in both editor and viewer contexts).
 * @returns {Array<HTMLElement|string>} Nodes/text ready for `.append(...)`.
 */
export function renderCommentBodyNodes(body, h) {
  const nodes = [];
  for (const seg of splitCommentSegments(body)) {
    if (seg.type === 'mention') {
      nodes.push(
        h('span', {
          class: 'comment-mention-chip',
          title: seg.email,
          text: `@${seg.name}`,
        })
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
        })
      );
    } else {
      nodes.push(seg.text);
    }
  }
  return nodes;
}
